<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { calendarWindow, calendarSummary, newsStatus, type CalEvent, type CalSummary } from '$lib/api';
  import Select from './Select.svelte';

  const DAY = 86400;
  const day0 = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
  /** The list always opens on the next event: past events are above (scroll up), the coming ones below. */
  const RANGES: { id: string; label: string; from: (d: Date) => number; to: (d: Date) => number }[] = [
    { id: 'pm7', label: '±7 days', from: (d) => day0(d) - 7 * DAY, to: (d) => day0(d) + 8 * DAY },
    { id: 'pm14', label: '±14 days', from: (d) => day0(d) - 14 * DAY, to: (d) => day0(d) + 15 * DAY },
  ];

  const KINDS: ['all' | CalEvent['kind'], string][] = [['all', 'All'], ['macro', 'Macro'], ['earnings', 'Earnings'], ['dividend', 'Dividends'], ['split', 'Splits'], ['ipo', 'IPOs']];
  const IMP = { high: 3, medium: 2, low: 1, holiday: 0 } as const;
  const KIND_NAME: Record<string, string> = { macro: 'Economic release', earnings: 'Earnings', dividend: 'Ex-dividend', split: 'Stock split', ipo: 'IPO' };
  const LABELS: Record<string, [string, string, string]> = { macro: ['Actual', 'Forecast', 'Previous'], earnings: ['', 'EPS estimate', 'Last year EPS'], dividend: ['Dividend', '', ''], split: ['', '', ''], ipo: ['', '', ''] };

  let range = $state('pm7');
  /** the event the list is anchored on (top of the list): from a chart marker, else the next upcoming one */
  let anchorId = $state<string | null>(null);
  /** once the user scrolls by hand the list stops re-anchoring when data arrives */
  let userScrolled = false;
  let kind = $state<'all' | CalEvent['kind']>('all');
  let impact = $state<'all' | 'medium' | 'high'>('all');
  let region = $state('all');
  let mine = $state(false);
  let query = $state('');

  let items = $state<CalEvent[]>([]);
  let errors = $state<{ provider: string; error: string }[]>([]);
  let loading = $state(false);
  let pending = $state(false);
  let loaded = $state(false);
  let sel = $state<string | null>(app.calFocus.id);
  let listEl = $state<HTMLDivElement>();
  let hasGroq = $state(false);
  let nowS = $state(Math.floor(Date.now() / 1000));

  const q = $derived(query.trim().toLowerCase());
  /** symbols the user follows: watchlists and the symbols of the open charts */
  const mySymbols = $derived(new Set([...app.watchlists.flatMap((l) => l.symbols), ...app.charts.map((c) => c.symbol)].map((s) => s.replace('/', '').toUpperCase())));
  const regions = $derived([...new Set(items.filter((e) => e.kind === 'macro').map((e) => e.country))].filter(Boolean).sort());

  /** Impact applies to macro events and earnings (company size); everything else is shown. A search ignores it, so small companies can be found. */
  function visible(e: CalEvent): boolean {
    if (kind !== 'all' && e.kind !== kind) return false;
    if (q) return (e.symbol ?? '').toLowerCase().includes(q) || e.title.toLowerCase().includes(q) || e.country.toLowerCase().includes(q);
    if ((e.kind === 'macro' || e.kind === 'earnings') && impact !== 'all' && IMP[e.impact] < (impact === 'high' ? 3 : 2)) return false;
    if (region !== 'all' && e.kind === 'macro' && e.country !== region) return false;
    if (mine && e.kind !== 'macro' && !mySymbols.has((e.symbol ?? '').toUpperCase())) return false;
    return true;
  }
  const shown = $derived(items.filter(visible));
  const hidden = $derived(items.length - shown.length);
  const groups = $derived.by(() => {
    const out: { key: string; day: string; today: boolean; rows: CalEvent[] }[] = [];
    const t0 = day0(new Date(nowS * 1000));
    for (const e of shown) {
      const d = new Date(e.ts * 1000);
      const key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(e);
      else out.push({ key, day: d.toLocaleDateString(app.lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: '2-digit', month: 'long' }), today: day0(d) === t0, rows: [e] });
    }
    return out;
  });
  const current = $derived(items.find((e) => e.id === sel) ?? null);
  /** the next upcoming event that passes the filters: the list is anchored on it */
  const next = $derived(shown.find((e) => e.ts >= nowS));

  // ---------------------------------------------------------------- data
  let timer: ReturnType<typeof setTimeout> | undefined;
  let run = 0;
  /** Shows what is cached at once; while the backend still fetches company days in the background, ask again every 2 s. */
  async function load(force = false, tries = 0) {
    clearTimeout(timer);
    const my = ++run;
    const r = RANGES.find((x) => x.id === range)!, d = new Date();
    loading = true;
    try {
      const res = await calendarWindow(r.from(d), r.to(d), force);
      if (my !== run) return;
      items = res.items; errors = res.errors; pending = res.pending; loaded = true;
      if (res.pending && tries < 60) timer = setTimeout(() => load(false, tries + 1), 2000);
    } catch (e) { if (my === run) { errors = [{ provider: 'calendar', error: String(e) }]; pending = false; loaded = true; } }
    finally { if (my === run) loading = false; }
  }
  $effect(() => { void range; untrack(() => { userScrolled = false; load(); }); });

  onMount(() => {
    newsStatus().then((s) => (hasGroq = s.groq));
    // keep checking for the latest events: every 5 minutes and when the window gets focus (the backend decides what is stale)
    const iv = setInterval(() => load(), 5 * 60 * 1000), clock = setInterval(() => (nowS = Math.floor(Date.now() / 1000)), 30000), onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(timer); clearInterval(iv); clearInterval(clock); window.removeEventListener('focus', onFocus); };
  });

  // a chart marker opened the page on one event: select it and put it at the top of the list
  $effect(() => {
    const want = app.calFocus.id;
    if (!want) return;
    const e = items.find((x) => x.id === want);
    if (e) { sel = want; anchorId = want; userScrolled = false; app.calFocus = { id: null }; }
    else if (loaded && range === 'pm7') range = 'pm14'; // the chart looks 10 days ahead
  });
  /** Put the anchor event (or the next upcoming one) at the top of the list, just under the sticky day header. */
  function anchorList() {
    if (!listEl || !shown.length) return;
    const target = (anchorId && shown.find((e) => e.id === anchorId)) || shown.find((e) => e.ts >= nowS) || shown[shown.length - 1];
    const row = [...listEl.querySelectorAll<HTMLElement>('.row')].find((r) => r.dataset.id === target.id);
    const head = listEl.querySelector<HTMLElement>('.day');
    if (row) listEl.scrollTop = Math.max(0, row.offsetTop - (head?.offsetHeight ?? 0));
  }
  $effect(() => {
    void groups; void anchorId;
    if (userScrolled) return;
    tick().then(anchorList);
  });
  const touch = () => (userScrolled = true);
  function jumpNext() { if (next) { sel = next.id; anchorId = next.id; userScrolled = false; tick().then(anchorList); } }
  // nothing selected yet: the next upcoming event (or the first one)
  $effect(() => { if (!sel && shown.length) sel = (next ?? shown[0]).id; });

  // ---------------------------------------------------------------- AI summary
  let ai = $state<CalSummary | null>(null);
  let aiState = $state<'idle' | 'loading' | 'error'>('idle');
  let aiErr = $state('');
  let aiFor = '';
  async function summarize(force = false) {
    const ev = current;
    if (!ev) return;
    aiFor = ev.id; aiState = 'loading'; aiErr = ''; if (force) ai = null;
    try {
      const r = await calendarSummary($state.snapshot(ev) as CalEvent, app.lang, force);
      if (aiFor === ev.id) { ai = r; aiState = 'idle'; }
    } catch (e) { if (aiFor === ev.id) { aiState = 'error'; aiErr = String(e); ai = null; } }
  }
  $effect(() => {
    const id = current?.id, actual = current?.actual;
    void actual;
    ai = null; aiErr = '';
    if (!id) { aiState = 'idle'; return; }
    if (hasGroq) untrack(() => summarize(false)); else aiState = 'idle';
  });

  // ---------------------------------------------------------------- formatting
  const hhmm = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleString(app.lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'full', timeStyle: 'short' });
  function rel(ts: number): string {
    const d = ts - nowS, a = Math.abs(d);
    const t = a < 3600 ? `${Math.max(1, Math.round(a / 60))} min` : a < DAY ? `${Math.floor(a / 3600)} h ${Math.round((a % 3600) / 60)} min` : `${Math.round(a / DAY)} d`;
    return d >= 0 ? `in ${t}` : `${t} ago`;
  }
  /** "3.1%" / "$2.98" / "1.2M" -> number, for comparing actual with forecast */
  function num(v: string | null): number | null {
    if (!v) return null;
    const m = /^[^\d-]*(-?[\d.,]+)\s*([KMBT%]?)/i.exec(v.replace(/[()]/g, '-').replace(/--/g, ''));
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 } as Record<string, number>)[m[2].toUpperCase()] || n : null;
  }
  function surprise(e: CalEvent): 'above' | 'below' | 'inline' | null {
    const a = num(e.actual), f = num(e.forecast);
    if (a === null || f === null) return null;
    return a > f ? 'above' : a < f ? 'below' : 'inline';
  }
  const impactColor = (i: string) => (i === 'high' ? 'var(--down)' : i === 'medium' ? '#ff9800' : 'var(--dim)');
  function goChart(sym: string) { app.chart.symbol = sym; app.persist(); app.page = 'chart'; }
  /** phone: the list and the detail take turns */
  let mOpen = $state(false);
  const back = () => (app.page = 'chart');
</script>

<svelte:window onkeydown={(e) => { if (app.page === 'calendar' && e.key === 'Escape' && !app.spotlight.open && !(e.target as HTMLElement)?.closest('input')) back(); }} />

<div class="page">
  <header>
    <button class="back" onclick={back}>← Charts</button>
    <h1>Calendar</h1>
    <div class="seg">
      {#each RANGES as r (r.id)}<button class:on={range === r.id} onclick={() => (range = r.id)}>{r.label}</button>{/each}
    </div>
    {#if next}
      <button class="next" onclick={jumpNext} title="Jump to the next event">
        <i style:background={impactColor(next.impact)}></i><span>Next: {next.symbol ?? next.country} {next.title}</span><b>{rel(next.ts)}</b>
      </button>
    {/if}
    <div class="spacer"></div>
    {#if pending}<span class="dim">Loading company data…</span>{/if}
    <button class="ghost" onclick={() => load(true)} disabled={loading}>Refresh</button>
  </header>

  <div class="filters">
    <div class="seg">{#each KINDS as [id, label] (id)}<button class:on={kind === id} onclick={() => (kind = id)}>{label}</button>{/each}</div>
    <span class="dim">Impact</span>
    <div class="seg">{#each [['all', 'All'], ['medium', 'Medium +'], ['high', 'High']] as [id, label] (id)}<button class:on={impact === id} onclick={() => (impact = id as typeof impact)}>{label}</button>{/each}</div>
    <Select value={region} options={[{ value: 'all', label: 'All regions' }, ...regions.map((c) => ({ value: c, label: c }))]} onchange={(v) => (region = v)} width="130px" />
    <label class="tg" title="Show company events only for your watchlist and the symbols of your charts"><input type="checkbox" bind:checked={mine} /><span>My symbols only</span></label>
    <input class="q" bind:value={query} placeholder="Symbol, company or region…" spellcheck="false" autocomplete="off" aria-label="Search" />
  </div>

  <div class="cols" class:mdetail={mOpen}>
    <div class="list" bind:this={listEl} onwheel={touch} onpointerdown={touch} onkeydown={touch} role="presentation">
      {#each groups as g (g.key)}
        <div class="day" class:today={g.today}>{g.day}{#if g.today}<i>today</i>{/if}</div>
        {#each g.rows as e, i (e.id + ':' + i)}
          {@const lab = LABELS[e.kind] ?? LABELS.macro}
          {@const sp = surprise(e)}
          <button class="row" data-id={e.id} class:on={e.id === sel} class:past={e.ts < nowS} onclick={() => { sel = e.id; mOpen = true; }}>
            <span class="t">{hhmm(e.ts)}</span>
            <span class="c" class:co={e.kind !== 'macro'}>{e.symbol ?? e.country}</span>
            <span class="i" style:--c={impactColor(e.impact)} title={e.impact}><u class:f={IMP[e.impact] >= 1}></u><u class:f={IMP[e.impact] >= 2}></u><u class:f={IMP[e.impact] >= 3}></u></span>
            <span class="n">{e.title}{#if e.detail}<small>{e.detail}</small>{/if}</span>
            <span class="v">
              {#if lab[0] && e.actual}<b class={sp ?? ''}>{e.actual}</b>{/if}
              {#if lab[1] && e.forecast}<em title={lab[1]}>{e.forecast}</em>{/if}
              {#if lab[2] && e.previous}<small title={lab[2]}>{e.previous}</small>{/if}
            </span>
          </button>
        {/each}
      {/each}
      {#if !shown.length}
        <div class="note">
          {#if !loaded || (pending && !items.length)}Loading…
          {:else if items.length}{hidden} event{hidden === 1 ? '' : 's'} hidden by the filters. <button class="lnk" onclick={() => { kind = 'all'; impact = 'all'; region = 'all'; mine = false; query = ''; }}>Clear filters</button>
          {:else}No events in this range.{/if}
        </div>
      {:else if hidden}<div class="note small">{hidden} more hidden by the filters.</div>{/if}
      {#each errors as er}<div class={er.provider === 'fmp' ? 'note small' : 'err'}>{er.provider}: {er.error}</div>{/each}
      <div class="note small">Macro: Forex Factory (USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, CNY){items.some((e) => e.provider === 'fmp') ? ' and Financial Modeling Prep' : '; a free Financial Modeling Prep key in Settings adds more countries and actual values'}. Companies: Nasdaq, 30 days back to 21 ahead. Times in your time zone.</div>
    </div>

    <div class="detail">
      <button class="mback" onclick={() => (mOpen = false)}>← Events</button>
      {#if current}
        {@const lab = LABELS[current.kind] ?? LABELS.macro}
        {@const sp = surprise(current)}
        <div class="kind"><span class="c" class:co={current.kind !== 'macro'}>{current.symbol ?? current.country}</span><span>{KIND_NAME[current.kind] ?? current.kind}</span>
          <span class="imp" style:--c={impactColor(current.impact)}>{current.impact} impact</span></div>
        <h2>{current.title}</h2>
        <div class="meta"><span>{fmtTime(current.ts)}</span><span class="rel">{rel(current.ts)}</span></div>
        {#if current.detail}<p class="det">{current.detail}</p>{/if}

        {#if lab.some(Boolean)}
          {@const boxes = [[lab[0], current.actual], [lab[1], current.forecast], [lab[2], current.previous]].filter(([l, v]) => l && v)}
          {#if boxes.length}
            <div class="vals">
              {#each boxes as [l, v], i (l)}<div><small>{l}</small><b class={l === lab[0] ? sp ?? '' : ''}>{v}</b>{#if l === lab[0] && sp}<span class="sp {sp}">{sp === 'above' ? 'above forecast' : sp === 'below' ? 'below forecast' : 'in line'}</span>{/if}</div>{/each}
            </div>
          {:else}
            <p class="det">No figures for this event: announcements, speeches and holidays have none.{current.kind === 'macro' ? ' Actual values are not part of the free Forex Factory feed.' : ''}</p>
          {/if}
        {/if}

        <section class="ai">
          <div class="aih"><span>AI reading</span><small>{ai ? ai.model : 'Groq'}</small>{#if hasGroq}<button onclick={() => summarize(true)} disabled={aiState === 'loading'}>Regenerate</button>{/if}</div>
          {#if !hasGroq}
            <p class="dim">Add a Groq API key in Settings to get a short explanation for every event: what it is, why it matters and how markets usually react.</p>
            <button class="primary" onclick={() => (app.settingsOpen = true)}>Open settings</button>
          {:else if aiState === 'loading'}
            <div class="skel"></div><div class="skel s2"></div>
          {:else if aiState === 'error'}
            <p class="errt">{aiErr}</p>
          {:else if ai}
            <div class="badges">
              <span class="int" title="Expected volatility {ai.volatility}/5">{#each [1, 2, 3, 4, 5] as n}<i class:f={n <= ai.volatility}></i>{/each}</span><span class="dim">expected volatility</span>
              {#each ai.assets as a}<span class="asset">{a}</span>{/each}
            </div>
            <p><b>What it is</b> {ai.what}</p>
            <p><b>Why it matters</b> {ai.why}</p>
            <p><b class="up">If better than forecast</b> {ai.above}</p>
            <p><b class="dn">If worse than forecast</b> {ai.below}</p>
            <small class="dim">AI estimate, not investment advice.</small>
          {/if}
        </section>

        <div class="acts">
          {#if current.symbol}<button class="primary" onclick={() => goChart(current.symbol!)}>Open {current.symbol} chart</button>
            <button class="ghost" onclick={() => app.openNews(current.symbol!)}>News for {current.symbol}</button>{/if}
        </div>
      {:else}
        <p class="dim pad">Select an event.</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .page { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  h1 { margin: 0; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; }
  .back, .ghost { box-sizing: border-box; height: 30px; background: none; border: 1px solid var(--line); color: var(--fg); padding: 0 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .back:hover, .ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); } .ghost:disabled { opacity: 0.5; cursor: default; }
  .seg { display: flex; border: 1px solid var(--line); }
  .seg button { height: 28px; background: none; border: 0; color: var(--dim); padding: 0 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .seg button:hover { color: var(--fg); } .seg button.on { background: var(--accent); color: #fff; }
  .next { display: inline-flex; align-items: center; gap: 8px; box-sizing: border-box; height: 30px; padding: 0 12px; background: none; border: 1px solid var(--line); color: var(--fg); font: 12px system-ui, sans-serif; cursor: pointer; max-width: 460px; }
  .next:hover { border-color: var(--accent); } .next i { width: 6px; height: 14px; flex: none; } .next span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .next b { color: var(--accent); font: 700 12px ui-monospace, monospace; flex: none; }
  .spacer { flex: 1; }
  .filters { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .dim { color: var(--dim); font-size: 12.5px; }
  .tg { display: flex; align-items: center; gap: 8px; font-size: 12.5px; cursor: pointer; } .tg input { accent-color: var(--accent); }
  .q { box-sizing: border-box; height: 30px; width: 230px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 0 10px; font: 12.5px system-ui, sans-serif; outline: none; margin-left: auto; } .q:focus { border-color: var(--accent); }
  .cols { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(420px, 52%) 1fr; }
  .list { position: relative; overflow-y: auto; border-right: 1px solid var(--line); }
  .day { position: sticky; top: 0; z-index: 1; background: var(--bg); padding: 10px 16px 6px; font: 700 11px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); border-bottom: 1px solid var(--line); }
  .day i { font-style: normal; margin-left: 10px; background: var(--accent); color: #fff; padding: 1px 7px; font-size: 10px; }
  .row { display: grid; grid-template-columns: 44px 58px 34px 1fr auto; gap: 10px; align-items: center; width: 100%; text-align: left; padding: 8px 16px; background: none; border: 0; border-bottom: 1px solid var(--line); border-left: 2px solid transparent; color: var(--fg); font: 13px system-ui, sans-serif; cursor: pointer; }
  .row:hover { background: var(--hover); } .row.on { background: var(--accent-soft); border-left-color: var(--accent); } .row.past { opacity: 0.6; } .row.on.past { opacity: 1; }
  .t { font: 11.5px ui-monospace, monospace; color: var(--dim); }
  .c { font: 700 10.5px ui-monospace, monospace; padding: 2px 5px; border: 1px solid var(--line); text-align: center; overflow: hidden; text-overflow: ellipsis; }
  .c.co { color: var(--accent); border-color: var(--accent); }
  .i { display: inline-flex; gap: 2px; } .i u { width: 5px; height: 12px; background: var(--line); text-decoration: none; } .i u.f { background: var(--c); }
  .n { display: flex; flex-direction: column; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; } .n small { color: var(--dim); font: 400 11px system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; }
  .v { display: flex; gap: 10px; align-items: baseline; font: 12px ui-monospace, monospace; white-space: nowrap; }
  .v b { font-weight: 700; } .v b.above { color: var(--up); } .v b.below { color: var(--down); } .v em { font-style: normal; color: var(--fg); } .v small { color: var(--dim); }
  .note { padding: 16px; color: var(--dim); font-size: 13px; text-align: center; } .note.small { font-size: 11.5px; text-align: left; }
  .lnk { background: none; border: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; padding: 0; }
  .err { padding: 6px 16px; color: var(--down); font-size: 11.5px; }
  .detail { overflow-y: auto; padding: 18px 26px 40px; }
  .kind { display: flex; align-items: center; gap: 10px; color: var(--dim); font: 12px system-ui, sans-serif; margin-bottom: 8px; }
  .imp { margin-left: auto; color: var(--c); text-transform: uppercase; font: 700 10.5px system-ui, sans-serif; letter-spacing: 0.08em; border: 1px solid var(--c); padding: 1px 8px; }
  h2 { margin: 0 0 8px; font: 700 20px/1.3 system-ui, sans-serif; }
  .meta { display: flex; gap: 14px; flex-wrap: wrap; color: var(--dim); font: 12px system-ui, sans-serif; margin-bottom: 12px; } .rel { color: var(--accent); }
  .det { margin: 0 0 14px; color: var(--dim); font-size: 13px; }
  .vals { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  .vals > div { border: 1px solid var(--line); padding: 10px 16px; min-width: 120px; display: flex; flex-direction: column; gap: 4px; }
  .vals small { color: var(--dim); font: 10px system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.06em; } .vals b { font: 700 20px ui-monospace, monospace; }
  .vals b.above { color: var(--up); } .vals b.below { color: var(--down); }
  .sp { font: 600 11px system-ui, sans-serif; } .sp.above { color: var(--up); } .sp.below { color: var(--down); } .sp.inline { color: var(--dim); }
  .ai { border: 1px solid var(--accent); background: #0a0614; padding: 14px 16px 12px; margin-bottom: 20px; }
  .aih { display: flex; align-items: center; gap: 10px; font: 700 11px system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
  .aih small { color: var(--dim); text-transform: none; letter-spacing: 0; font-weight: 500; }
  .aih button { margin-left: auto; background: none; border: 1px solid var(--line); color: var(--fg); padding: 3px 9px; font: 600 11px system-ui, sans-serif; cursor: pointer; } .aih button:hover:not(:disabled) { border-color: var(--accent); } .aih button:disabled { opacity: 0.5; }
  .ai p { margin: 8px 0; font: 14px/1.5 system-ui, sans-serif; } .ai p b { color: var(--accent); margin-right: 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; } .ai p b.up { color: var(--up); } .ai p b.dn { color: var(--down); }
  .badges { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .int { display: inline-flex; gap: 3px; } .int i { width: 14px; height: 6px; background: var(--line); } .int i.f { background: var(--accent); }
  .asset { border: 1px solid var(--line); padding: 1px 8px; font: 11px ui-monospace, monospace; }
  .skel { height: 12px; background: linear-gradient(90deg, var(--line), #2a1250, var(--line)); background-size: 200% 100%; animation: sk 1.2s linear infinite; margin: 10px 0; } .skel.s2 { width: 70%; }
  @keyframes sk { to { background-position: -200% 0; } }
  .errt { color: var(--down); font-size: 13px; }
  .acts { display: flex; gap: 10px; }
  .primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; padding: 0 16px; height: 30px; font: 700 12px system-ui, sans-serif; cursor: pointer; } .primary:hover { filter: brightness(1.12); }
  .pad { padding: 20px 0; }
  .mback { display: none; }
  @media (max-width: 719px), (max-height: 479px) {
    header, .filters { flex-wrap: wrap; row-gap: 6px; }
    header :global(.q), .filters :global(.q) { flex: 1 1 100%; min-width: 0; width: auto; }
    .cols { display: block; position: relative; overflow: hidden; }
    .cols .list { height: 100%; overflow: auto; border-right: 0; }
    .cols .detail { display: none; height: 100%; overflow: auto; padding-bottom: 24px; }
    .cols.mdetail .list { display: none; }
    .cols.mdetail .detail { display: block; }
    .mback { display: block; margin: 8px 0; height: 40px; padding: 0 14px; background: none; border: 1px solid var(--line); color: var(--fg); font: 600 13px system-ui, sans-serif; }
  }
</style>
