<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { history } from '$lib/history.ts';
  import { comboOf, combosOf, hasCombo, isBuiltin } from '$lib/keybinds.ts';
  import { buildCommands } from '$lib/commands.svelte';
  import { startBuilderBackground } from '$lib/builder/cache';
  import KeybindsDialog from '$lib/ui/KeybindsDialog.svelte';
  import { app } from '$lib/app.svelte';
  import { onTick, streamSymbols } from '$lib/api';
  import Chart from '$lib/chart/Chart.svelte';
  import TopBar from '$lib/ui/TopBar.svelte';
  import LeftBar from '$lib/ui/LeftBar.svelte';
  import Watchlist from '$lib/ui/Watchlist.svelte';
  import AiDialog from '$lib/ui/AiDialog.svelte';
  import Analysis from '$lib/ui/Analysis.svelte';
  import NewsPage from '$lib/ui/NewsPage.svelte';
  import ScriptEditor from '$lib/ui/ScriptEditor.svelte';
  import CalendarPage from '$lib/ui/CalendarPage.svelte';
  import { library } from '$lib/library.svelte';
  import PaperPanel from '$lib/ui/PaperPanel.svelte';
  import OrderDialog from '$lib/ui/OrderDialog.svelte';
  import AccountDialog from '$lib/ui/AccountDialog.svelte';
  import { paper } from '$lib/paper/paper.svelte';
  import Spotlight from '$lib/ui/Spotlight.svelte';
  import Settings from '$lib/ui/Settings.svelte';
  import IndicatorDialog from '$lib/ui/IndicatorDialog.svelte';

  let center = $state<HTMLDivElement>();
  let ov = $state<HTMLDivElement>();
  let rcol = $state<HTMLDivElement>();
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const cols = $derived(['2v', '3', '4'].includes(app.layout) ? `${app.split.c}fr ${1 - app.split.c}fr` : undefined);
  const rows = $derived(['2h', '3', '4'].includes(app.layout) ? `${app.split.r}fr ${1 - app.split.r}fr` : undefined);

  function drag(e: PointerEvent, move: (ev: PointerEvent) => void) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); app.persist(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }
  function startDrag(e: PointerEvent, axis: 'c' | 'r') {
    drag(e, (ev) => {
      if (!ov) return;
      const r = ov.getBoundingClientRect();
      app.split[axis] = axis === 'c' ? clamp((ev.clientX - r.left) / r.width, 0.15, 0.85) : clamp((ev.clientY - r.top) / r.height, 0.15, 0.85);
    });
  }
  function startRightDrag(e: PointerEvent) {
    drag(e, (ev) => { app.split.rightW = clamp(window.innerWidth - ev.clientX - 11, 220, Math.min(700, window.innerWidth * 0.5)); });
  }
  function startListDrag(e: PointerEvent) {
    drag(e, (ev) => {
      if (!rcol) return;
      const r = rcol.getBoundingClientRect();
      app.split.listFrac = clamp((ev.clientY - r.top) / r.height, 0.12, 0.85);
    });
  }

  onMount(() => {
    app.load();
    library.load().then(() => startBuilderBackground());
    paper.load();
    // scripts added from outside (the oviate CLI) show up when the window gets focus again
    const refresh = () => library.load();
    window.addEventListener('focus', refresh);
    let off = () => {};
    onTick((t) => { app.ticks[t.symbol] = { p: t.price, s: t.size, t: t.t }; }).then((f) => (off = f));
    return () => { off(); window.removeEventListener('focus', refresh); };
  });
  $effect(() => { if (app.ready) streamSymbols([...new Set(app.charts.slice(0, app.count).map((c) => c.symbol))]); });

  $effect(() => {
    document.documentElement.dataset.theme = app.theme;
    document.documentElement.dataset.anim = app.anim ? '1' : '0';
  });
  $effect(() => { if (app.ready) { void [app.layout, app.active, app.theme, app.lang, app.grid, app.magnet, app.sync, app.showWatchlist, app.charts.map((c) => [c.symbol, c.tf, c.type, c.log, c.volume, c.indicators.length])]; app.persist(); } });

  // remember which charts were touched last (a smaller layout keeps those)
  $effect(() => { const id = app.charts[app.active]?.id; if (id) app.noteTouched(id); });

  // back / forward: page and bottom panel tab changes are recorded as steps (drawing edits are recorded by the charts)
  // every view the user can navigate to is part of one snapshot; a change of any part is one step
  type Nav = { page: typeof app.page; tab: string; psub: string; tsub: string; jsub: string; ed: string; mode: string; syms: string[] };
  const navNow = (): Nav => ({
    page: app.page, tab: paper.panelOpen ? paper.panelTab : '', psub: paper.sub, tsub: paper.testerSub, jsub: paper.journalSub,
    ed: JSON.stringify([app.editor.kind, app.editor.name, !!app.editor.blank]), mode: app.editorMode,
    syms: app.charts.slice(0, app.count).map((c) => `${c.id}|${c.symbol}|${c.tf}`)
  });
  const navKey = (n: Nav) => JSON.stringify(n);
  let navPrev = navNow();
  function goNav(n: Nav) {
    navPrev = n;
    app.page = n.page;
    paper.sub = n.psub as typeof paper.sub; paper.testerSub = n.tsub as typeof paper.testerSub; paper.journalSub = n.jsub as typeof paper.journalSub;
    if (n.tab) { paper.panelTab = n.tab as typeof paper.panelTab; paper.panelOpen = true; } else paper.panelOpen = false;
    const [kind, name, blank] = JSON.parse(n.ed);
    app.editor = { kind, name, blank: blank || undefined };
    app.editorMode = n.mode as typeof app.editorMode;
    for (const s of n.syms) {
      const [id, symbol, tf] = s.split('|');
      const c = app.charts.find((x) => x.id === id);
      if (c && (c.symbol !== symbol || c.tf !== tf)) { c.symbol = symbol; c.tf = tf as typeof c.tf; }
    }
    paper.persist(); app.persist();
  }
  $effect(() => {
    const cur = navNow();
    untrack(() => {
      const from = navPrev;
      if (navKey(cur) === navKey(from)) return;
      // saving a new script gives it a name: that is not a place to go back to
      if (JSON.parse(from.ed)[1] === null && navKey({ ...cur, ed: from.ed }) === navKey(from)) { navPrev = cur; return; }
      navPrev = cur;
      history.push({ undo: () => goNav(from), redo: () => goNav(cur) });
    });
  });
  // text fields, numbers, checkboxes: a committed change (the `change` event) is a step that Ctrl+Z / back undoes while the field is not focused
  type Field = HTMLInputElement | HTMLTextAreaElement;
  const SKIP = new Set(['password', 'file', 'button', 'submit', 'radio', 'search', 'hidden']);
  const isField = (t: EventTarget | null): t is Field =>
    (t instanceof HTMLInputElement && !SKIP.has(t.type) || t instanceof HTMLTextAreaElement) && !t.hasAttribute('data-nohist') && !t.readOnly;
  const fieldVal = (el: Field) => (el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : el.value);
  const startVal = new WeakMap<Field, string>();
  function setField(el: Field, v: string) {
    if (!el.isConnected) return false;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = v === 'true'; else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    startVal.set(el, v);
  }
  const fieldFocus = (e: FocusEvent) => { if (isField(e.target)) startVal.set(e.target, fieldVal(e.target)); };
  function fieldChange(e: Event) {
    const el = e.target;
    if (!isField(el)) return;
    const now = fieldVal(el);
    const old = el instanceof HTMLInputElement && el.type === 'checkbox' ? String(!el.checked) : startVal.get(el);
    startVal.set(el, now);
    if (old === undefined || old === now) return;
    history.push({ undo: () => setField(el, old), redo: () => setField(el, now) });
  }
  onMount(() => {
    window.addEventListener('focusin', fieldFocus, true);
    window.addEventListener('change', fieldChange, true);
    return () => { window.removeEventListener('focusin', fieldFocus, true); window.removeEventListener('change', fieldChange, true); };
  });
  const stepBack = () => { if (!app.spotlight.open && !app.settingsOpen) history.back(); };
  const stepForward = () => { if (!app.spotlight.open && !app.settingsOpen) history.forward(); };
  // mouse back / forward buttons (the webview would otherwise try its own page history)
  const mouseDown = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };
  const mouseUp = (e: MouseEvent) => { if (e.button === 3) { e.preventDefault(); stepBack(); } else if (e.button === 4) { e.preventDefault(); stepForward(); } };

  function key(e: KeyboardEvent) {
    if (app.keybindsOpen) return; // the Keybinds dialog is recording a shortcut
    const combo = comboOf(e);
    const hit = (id: string) => hasCombo(id, combo, app.keybinds);
    if (hit('app.zoom_in')) { e.preventDefault(); app.zoomBy(1); return; }
    if (hit('app.zoom_out')) { e.preventDefault(); app.zoomBy(-1); return; }
    if (hit('app.zoom_reset')) { e.preventDefault(); app.setZoom(1); return; }
    const el = e.target as HTMLElement;
    const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    if (typing || e.defaultPrevented || app.spotlight.open || app.settingsOpen) return;
    if (hit('app.back')) { e.preventDefault(); stepBack(); return; }
    if (hit('app.forward')) { e.preventDefault(); stepForward(); return; }
    if (hit('app.cmdbar')) { e.preventDefault(); app.spotlight = { open: true, seed: '' }; return; }
    // a shortcut the user gave to a command-bar command
    const cmdId = combo ? Object.keys(app.keybinds).find((id) => !isBuiltin(id) && combosOf(app.keybinds[id]).includes(combo)) : undefined;
    if (cmdId) {
      const c = buildCommands().find((x) => x.id === cmdId);
      if (c) { e.preventDefault(); c.run(); app.persist(); return; }
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && /[a-z0-9/]/i.test(e.key)) {
      e.preventDefault(); app.spotlight = { open: true, seed: e.key };
    }
  }
</script>

<svelte:window onkeydown={key} onmousedown={mouseDown} onmouseup={mouseUp} />

<div class="app">
  <TopBar />
  {#if app.page === 'news'}<NewsPage />{/if}
  {#if app.page === 'editor'}<ScriptEditor />{/if}
  {#if app.page === 'calendar'}<CalendarPage />{/if}
  <div class="body" class:hid={app.page !== 'chart'}>
    <LeftBar />
    <div class="center" class:noright={!app.showWatchlist}>
     <div class="chartarea" bind:this={center}>
      <main class="grid l{app.layout}" class:flush={app.showWatchlist} style:grid-template-columns={cols} style:grid-template-rows={rows}>
        {#each app.charts.slice(0, app.count) as c, i (c.id)}
          <Chart bind:cfg={app.charts[i]} index={i} />
        {/each}
      </main>
      {#if ['2v', '3', '4'].includes(app.layout)}
        <div class="ov" class:flush={app.showWatchlist} bind:this={ov}>
          <div class="hv" style:left="calc(100% * {app.split.c})" role="separator" aria-orientation="vertical" onpointerdown={(e) => startDrag(e, 'c')}></div>
          {#if app.layout === '3' || app.layout === '4'}
            <div class="hh" class:half={app.layout === '3'} style:top="calc(100% * {app.split.r})" style:left={app.layout === '3' ? `calc(100% * ${app.split.c})` : '0'} role="separator" aria-orientation="horizontal" onpointerdown={(e) => startDrag(e, 'r')}></div>
          {/if}
        </div>
      {/if}
      {#if app.layout === '2h'}
        <div class="ov" class:flush={app.showWatchlist} bind:this={ov}>
          <div class="hh" style:top="calc(100% * {app.split.r})" role="separator" aria-orientation="horizontal" onpointerdown={(e) => startDrag(e, 'r')}></div>
        </div>
      {/if}
     </div>
     <PaperPanel />
    </div>
    {#if app.showWatchlist}
      <div class="vsplit" role="separator" aria-orientation="vertical" onpointerdown={startRightDrag}></div>
      <div class="rcol" bind:this={rcol} style:width="{app.split.rightW}px" style:grid-template-rows="{app.split.listFrac}fr 0px {1 - app.split.listFrac}fr">
        <Watchlist />
        <div class="lsplit" role="separator" aria-orientation="horizontal" onpointerdown={startListDrag}></div>
        <Analysis />
      </div>
    {/if}
  </div>
  {#if app.toast}<div class="toast">{app.toast}</div>{/if}
</div>

<Spotlight />
<AiDialog />
<Settings />
<KeybindsDialog />
<IndicatorDialog />
<OrderDialog />
<AccountDialog />

<style>
  :global(:root), :global(:root[data-theme='dark']) {
    --bg: #000; --bar: #000; --pane: #000; --line: #2a1250; --fg: #f1eaff; --dim: #8f7fb0;
    --accent: #9d4dff; --accent-soft: rgba(157, 77, 255, 0.2); --hover: rgba(157, 77, 255, 0.14);
    --up: #22e5ff; --down: #ff2d95; --glass: #0a0614; --glass-line: #4a1f8f;
  }
  :global(:root[data-theme='light']) {
    --bg: #fff; --bar: #faf7ff; --pane: #fff; --line: #d9c8f5; --fg: #17082e; --dim: #7a68a0;
    --accent: #7a2cf0; --accent-soft: rgba(122, 44, 240, 0.12); --hover: rgba(122, 44, 240, 0.08);
    --up: #0891b2; --down: #d61f7c; --glass: #ffffff; --glass-line: #b99af0;
  }
  :global(html), :global(body) { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font-family: Inter, system-ui, sans-serif; overflow: hidden; }
  :global(::selection) { background: #c9a6ff; color: #12002b; }
  :global(:root[data-theme='light'] ::selection) { background: #b78cff; color: #12002b; }
  :global(input[type='number']) { -moz-appearance: textfield; appearance: textfield; }
  :global(input[type='number']::-webkit-inner-spin-button), :global(input[type='number']::-webkit-outer-spin-button) { -webkit-appearance: none; appearance: none; margin: 0; display: none; }
  :global(select) { -webkit-appearance: none; appearance: none; background: #000 url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%239d4dff' stroke-width='1.5'/></svg>") no-repeat right 9px center; padding-right: 26px !important; border-radius: 0; }
  :global(option) { background: #000; color: #f1eaff; }
  :global(*) { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
  :global(:root[data-anim='0'] *) { animation-duration: 0s !important; transition-duration: 0s !important; }
  .app { display: flex; flex-direction: column; height: 100vh; }
  .body { flex: 1; display: flex; min-height: 0; }
  .body.hid { display: none; }
  .center { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .center.noright :global(.panel) { margin-right: 12px; }
  .chartarea { flex: 1; position: relative; min-width: 0; min-height: 0; display: flex; }
  .grid { flex: 1; display: grid; gap: 0; padding: 12px 12px 0; background: var(--bg); min-width: 0; min-height: 0; }
  .grid.flush { padding-right: 0; }
  /* sections touch: their own border lines are the drag handles (invisible hit zones straddle them) */
  .rcol { flex: none; display: grid; margin: 12px 12px 12px -1px; min-height: 0; min-width: 0; }
  .rcol > :global(*:last-child) { margin-top: -1px; }
  .vsplit, .lsplit { position: relative; z-index: 6; }
  .vsplit { width: 0; flex: none; margin: 12px 0; }
  .vsplit::before { content: ''; position: absolute; top: 0; bottom: 0; left: -5px; width: 10px; cursor: col-resize; }
  .lsplit { height: 0; }
  .lsplit::before { content: ''; position: absolute; left: 0; right: 0; top: -5px; height: 10px; cursor: row-resize; }
  .ov { position: absolute; inset: 12px; pointer-events: none; z-index: 6; }
  .ov.flush { right: 0; }
  .hv, .hh { position: absolute; pointer-events: auto; }
  .hv { top: 0; bottom: 0; width: 10px; margin-left: -5px; cursor: col-resize; }
  .hh { left: 0; right: 0; height: 10px; margin-top: -5px; cursor: row-resize; }
  .grid :global(.pane:nth-child(n + 2)) { margin-left: -1px; }
  .l2h :global(.pane:nth-child(2)), .l3 :global(.pane:nth-child(3)), .l4 :global(.pane:nth-child(n + 3)) { margin-top: -1px; }
  .l2h :global(.pane:nth-child(2)), .l3 :global(.pane:nth-child(1)), .l1 :global(.pane) { margin-left: 0; }
  .l4 :global(.pane:nth-child(3)) { margin-left: 0; }
  .l1 { grid-template: 1fr / 1fr; }
  .l2v { grid-template-rows: 1fr; }
  .l2h { grid-template-columns: 1fr; }
  .l3 :global(.pane:first-child) { grid-row: 1 / span 2; }
  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); padding: 10px 18px; border-radius: 2px; font-size: 13px; background: var(--glass); border: 1px solid var(--glass-line); z-index: 200; }
</style>
