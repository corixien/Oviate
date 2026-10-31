<script lang="ts">
  /** phone: the list and the detail take turns */
  let mOpen = $state(false);
  import { onMount, tick } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { newsWindow, aiSummary, newsStatus, openUrl, type NewsItem, type AiSummary } from '$lib/api';

  const WEEK = 7 * 86400;
  let items = $state<NewsItem[]>([]);
  let weeks = $state(0);
  let loading = $state(false);
  let done = $state(false);
  let errors = $state<{ provider: string; error: string }[]>([]);
  let sel = $state<string | null>(null);
  let provider = $state('all');
  let query = $state('');
  let listEl = $state<HTMLDivElement>();
  let hasGroq = $state(false);
  let runId = 0;

  const focusSym = $derived(app.newsFocus.symbol);
  const shown = $derived(items.filter((i) =>
    (provider === 'all' || i.provider === provider) &&
    (!query.trim() || (i.headline + ' ' + i.source + ' ' + i.summary).toLowerCase().includes(query.trim().toLowerCase()))));
  const providers = $derived([...new Set(items.map((i) => i.provider))].sort());
  const current = $derived(items.find((i) => i.id === sel) ?? null);

  /** Day groups for the list. */
  const groups = $derived.by(() => {
    const out: { day: string; rows: NewsItem[] }[] = [];
    for (const it of shown) {
      const day = new Date(it.ts * 1000).toLocaleDateString(app.lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(it); else out.push({ day, rows: [it] });
    }
    return out;
  });

  async function loadWeek(run: number) {
    const now = Math.floor(Date.now() / 1000);
    const to = now - weeks * WEEK, from = to - WEEK;
    const res = await newsWindow(focusSym, from, to);
    if (run !== runId) return 0;
    weeks += 1;
    errors = res.errors;
    const have = new Set(items.map((i) => i.id));
    const fresh = res.items.filter((i) => !have.has(i.id));
    items = [...items, ...fresh].sort((a, b) => b.ts - a.ts);
    return fresh.length;
  }

  let emptyStreak = 0;
  async function more() {
    if (loading || done) return;
    const run = runId;
    loading = true;
    try {
      const n = await loadWeek(run);
      if (run !== runId) return;
      emptyStreak = n === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= 3 || weeks >= 104) done = true;
    } catch (e) { errors = [{ provider: 'news', error: String(e) }]; }
    finally { if (run === runId) loading = false; }
    await tick();
    // Fill the viewport when the first weeks are short.
    if (run === runId && !done && listEl && listEl.scrollHeight <= listEl.clientHeight + 40) more();
  }

  async function reset() {
    runId++;
    items = []; weeks = 0; done = false; loading = false; emptyStreak = 0; errors = [];
    const want = app.newsFocus.id;
    sel = want;
    await more();
    // Opened from a chart marker: keep loading until the item is in the list (max 6 weeks).
    while (want && !items.some((i) => i.id === want) && weeks < 6 && !done) await more();
    if (want && items.some((i) => i.id === want)) { sel = want; await tick(); document.querySelector('.row.on')?.scrollIntoView({ block: 'center' }); }
    else if (!sel && items.length) sel = items[0].id;
  }

  let lastFocus = '';
  $effect(() => {
    const k = (app.newsFocus.symbol ?? '*') + '|' + (app.newsFocus.id ?? '');
    if (k === lastFocus) return;
    lastFocus = k;
    reset();
  });
  /** Newest news: re-check the latest week and put anything new at the top. */
  async function refreshLatest() {
    if (loading) return;
    const now = Math.floor(Date.now() / 1000);
    try {
      const res = await newsWindow(focusSym, now - WEEK, now);
      const have = new Set(items.map((i) => i.id));
      const fresh = res.items.filter((i) => !have.has(i.id));
      if (fresh.length) items = [...fresh, ...items].sort((a, b) => b.ts - a.ts);
    } catch { /* the next round tries again */ }
  }
  onMount(() => {
    newsStatus().then((s) => (hasGroq = s.groq));
    const iv = setInterval(refreshLatest, 3 * 60 * 1000), onFocus = () => refreshLatest();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus); };
  });

  function onScroll() {
    if (!listEl) return;
    if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 240) more();
  }

  // ----- AI summary for the selected item -----
  let ai = $state<AiSummary | null>(null);
  let aiState = $state<'idle' | 'loading' | 'error'>('idle');
  let aiErr = $state('');
  let aiFor = '';

  async function summarize(force = false) {
    const id = sel;
    if (!id) return;
    aiFor = id; aiState = 'loading'; aiErr = ''; if (force) ai = null;
    try {
      const r = await aiSummary(id, app.lang, force);
      if (aiFor === id) { ai = r; aiState = 'idle'; }
    } catch (e) { if (aiFor === id) { aiState = 'error'; aiErr = String(e); ai = null; } }
  }
  $effect(() => {
    const id = sel;
    ai = null; aiErr = '';
    if (!id) { aiState = 'idle'; return; }
    if (hasGroq) summarize(false); else aiState = 'idle';
  });

  const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleString(app.lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const hhmm = (ts: number) => new Date(ts * 1000).toTimeString().slice(0, 5);
  const dirColor = (d: string) => (d === 'bullish' ? 'var(--up)' : d === 'bearish' ? 'var(--down)' : 'var(--accent)');

  function goChart(sym: string) { app.chart.symbol = sym; app.persist(); app.page = 'chart'; }
  function back() { app.page = 'chart'; }
</script>

<svelte:window onkeydown={(e) => { if (app.page === 'news' && e.key === 'Escape' && !app.spotlight.open) back(); }} />

<div class="page">
  <header>
    <button class="back" onclick={back}>← Charts</button>
    <h1>News</h1>
    {#if focusSym}
      <button class="chip on" onclick={() => (app.newsFocus = { symbol: null, id: null })} title="Show all markets">{focusSym} ×</button>
    {/if}
    <input class="q" bind:value={query} placeholder="Filter headlines…" spellcheck="false" />
    <div class="chips">
      <button class="chip" class:on={provider === 'all'} onclick={() => (provider = 'all')}>All</button>
      {#each providers as p}<button class="chip" class:on={provider === p} onclick={() => (provider = p)}>{p}</button>{/each}
    </div>
  </header>

  <div class="cols" class:mdetail={mOpen}>
    <div class="list" bind:this={listEl} onscroll={onScroll}>
      {#each groups as g (g.day)}
        <div class="day">{g.day}</div>
        {#each g.rows as it (it.id)}
          <button class="row" class:on={it.id === sel} onclick={() => { sel = it.id; mOpen = true; }}>
            <span class="t">{hhmm(it.ts)}</span>
            <span class="h">{it.headline}</span>
            <span class="m">{it.source || it.provider}<i>{it.provider}</i></span>
          </button>
        {/each}
      {/each}
      {#if loading}<div class="note">Loading week {weeks + 1}…</div>{/if}
      {#if done && !loading}<div class="note">No older news found.</div>{/if}
      {#if !loading && !items.length && !done}<div class="note">Nothing yet.</div>{/if}
      {#each errors as e}<div class="err">{e.provider}: {e.error}</div>{/each}
    </div>

    <div class="detail">
      <button class="mback" onclick={() => (mOpen = false)}>← Headlines</button>
      {#if current}
        <section class="ai" style:--dir={ai ? dirColor(ai.direction) : 'var(--accent)'}>
          <div class="aih"><span>AI summary</span><small>{ai ? ai.model : 'Groq'}</small>
            {#if hasGroq}<button onclick={() => summarize(true)} disabled={aiState === 'loading'}>Regenerate</button>{/if}</div>
          {#if !hasGroq}
            <p class="dim">Add a Groq API key in Settings to get a short summary with market impact for every headline.</p>
            <button class="primary" onclick={() => (app.settingsOpen = true)}>Open settings</button>
          {:else if aiState === 'loading'}
            <div class="skel"></div><div class="skel s2"></div>
          {:else if aiState === 'error'}
            <p class="errt">{aiErr}</p>
          {:else if ai}
            <div class="badges">
              <b class="dir">{ai.direction}</b>
              <span class="int" title="Intensity {ai.intensity}/5">{#each [1, 2, 3, 4, 5] as n}<i class:f={n <= ai.intensity}></i>{/each}</span>
              <span class="dim">{ai.horizon}</span>
              {#each ai.assets as a}<span class="asset">{a}</span>{/each}
            </div>
            <p><b>What happened</b> {ai.what}</p>
            <p><b>Likely impact</b> {ai.impact}</p>
            <small class="dim">AI estimate from the headline and summary only. Not investment advice.</small>
          {/if}
        </section>

        <h2>{current.headline}</h2>
        <div class="meta"><span>{current.source || current.provider}</span><span>{fmtTime(current.ts)}</span><span class="pv">{current.provider}</span></div>
        {#if current.symbols.length}
          <div class="syms">{#each current.symbols as s}<button class="chip" onclick={() => (app.newsFocus = { symbol: s, id: null })}>{s}</button><button class="chip go" title="Open chart" onclick={() => goChart(s)}>chart</button>{/each}</div>
        {/if}
        {#if current.summary}<p class="body">{current.summary}</p>{:else}<p class="dim">No summary from this provider. Open the article for details.</p>{/if}
        {#if current.url}<button class="primary" onclick={() => openUrl(current.url)}>Open article ↗</button>{/if}
      {:else}
        <p class="dim pad">Select a headline.</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .page { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  h1 { margin: 0; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; }
  .back { box-sizing: border-box; height: 30px; background: none; border: 1px solid var(--line); color: var(--fg); padding: 0 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .back:hover { border-color: var(--accent); color: var(--accent); }
  .q { flex: 0 1 240px; box-sizing: border-box; height: 30px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 0 10px; font: 13px system-ui, sans-serif; outline: none; }
  .q:focus { border-color: var(--accent); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
  .chip { background: none; border: 1px solid var(--line); color: var(--dim); padding: 4px 10px; font: 600 11px system-ui, sans-serif; cursor: pointer; text-transform: capitalize; }
  .chip:hover { color: var(--fg); border-color: var(--accent); }
  .chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .chip.go { text-transform: none; margin-right: 8px; }
  .cols { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(340px, 42%) 1fr; gap: 0; }
  .list { overflow-y: auto; border-right: 1px solid var(--line); }
  .day { position: sticky; top: 0; z-index: 1; background: var(--bg); padding: 10px 16px 6px; font: 700 11px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); border-bottom: 1px solid var(--line); }
  .row { display: grid; grid-template-columns: 44px 1fr; grid-template-areas: 't h' '. m'; gap: 2px 10px; width: 100%; text-align: left; padding: 10px 16px; background: none; border: 0; border-bottom: 1px solid var(--line); color: var(--fg); cursor: pointer; border-left: 2px solid transparent; }
  .row:hover { background: var(--hover); }
  .row.on { background: var(--accent-soft); border-left-color: var(--accent); }
  .t { grid-area: t; font: 11px ui-monospace, monospace; color: var(--dim); padding-top: 2px; }
  .h { grid-area: h; font: 600 13.5px/1.35 system-ui, sans-serif; }
  .m { grid-area: m; font: 11.5px system-ui, sans-serif; color: var(--dim); display: flex; gap: 8px; align-items: center; }
  .m i { font-style: normal; border: 1px solid var(--line); padding: 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .note { padding: 16px; color: var(--dim); font-size: 13px; text-align: center; }
  .err { padding: 6px 16px; color: var(--down); font-size: 11.5px; }
  .detail { overflow-y: auto; padding: 18px 26px 40px; }
  .pad { padding: 20px 0; }
  .ai { border: 1px solid var(--dir); box-shadow: 0 0 18px color-mix(in srgb, var(--dir) 22%, transparent); background: #0a0614; padding: 14px 16px 12px; margin-bottom: 20px; }
  .aih { display: flex; align-items: center; gap: 10px; font: 700 11px system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dir); margin-bottom: 10px; }
  .aih small { color: var(--dim); text-transform: none; letter-spacing: 0; font-weight: 500; }
  .aih button { margin-left: auto; background: none; border: 1px solid var(--line); color: var(--fg); padding: 3px 9px; font: 600 11px system-ui, sans-serif; cursor: pointer; }
  .aih button:hover:not(:disabled) { border-color: var(--accent); } .aih button:disabled { opacity: 0.5; }
  .ai p { margin: 8px 0; font: 14px/1.5 system-ui, sans-serif; } .ai p b { color: var(--dir); margin-right: 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
  .badges { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .dir { color: #fff; background: var(--dir); padding: 2px 10px; font: 800 12px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
  .int { display: inline-flex; gap: 3px; } .int i { width: 14px; height: 6px; background: var(--line); } .int i.f { background: var(--dir); box-shadow: 0 0 6px var(--dir); }
  .asset { border: 1px solid var(--line); padding: 1px 8px; font: 11px ui-monospace, monospace; color: var(--fg); }
  .skel { height: 12px; background: linear-gradient(90deg, var(--line), #2a1250, var(--line)); background-size: 200% 100%; animation: sk 1.2s linear infinite; margin: 10px 0; } .skel.s2 { width: 70%; }
  @keyframes sk { to { background-position: -200% 0; } }
  .errt { color: var(--down); font-size: 13px; } .dim { color: var(--dim); font-size: 13px; }
  h2 { margin: 0 0 8px; font: 700 20px/1.3 system-ui, sans-serif; }
  .meta { display: flex; gap: 14px; flex-wrap: wrap; color: var(--dim); font: 12px system-ui, sans-serif; margin-bottom: 12px; }
  .pv { border: 1px solid var(--line); padding: 0 8px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
  .syms { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 14px; }
  .body { font: 15px/1.6 system-ui, sans-serif; margin: 0 0 18px; }
  .primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; padding: 9px 18px; font: 700 13px system-ui, sans-serif; cursor: pointer; }
  .primary:hover { filter: brightness(1.12); }
  .mback { display: none; }
  @media (max-width: 719px), (max-height: 479px) {
    header { flex-wrap: wrap; row-gap: 6px; }
    header :global(.q) { flex: 1 1 100%; min-width: 0; width: auto; }
    .cols { display: block; position: relative; overflow: hidden; }
    .cols .list { height: 100%; overflow: auto; border-right: 0; }
    .cols .detail { display: none; height: 100%; overflow: auto; padding-bottom: 24px; }
    .cols.mdetail .list { display: none; }
    .cols.mdetail .detail { display: block; }
    .mback { display: block; margin: 8px 0; height: 40px; padding: 0 14px; background: none; border: 1px solid var(--line); color: var(--fg); font: 600 13px system-ui, sans-serif; }
  }
</style>
