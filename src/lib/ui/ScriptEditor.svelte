<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { library, scriptMeta, type ScriptKind } from '$lib/library.svelte';
  import { paper } from '$lib/paper/paper.svelte';
  import { describeScript } from '$lib/pine/describe.ts';
  import { tick, untrack } from 'svelte';
  import { aiComplete, aiLight } from '$lib/api';
  import { editIndicator, editStrategy, extractStrategyForm, setStrategyParams, setDirection, codeSides, hasLimitInput, type StrategyOpts } from '$lib/ai/pine.ts';
  import { aiBuilder, aiMirrorSide, mirrorSideLocal } from '$lib/builder/ai.ts';
  import { convertCode, cachedModel, convertSoon } from '$lib/builder/cache';
  import { indInfo, allInfos } from '$lib/builder/info';
  import { builderModelOf, checkModel, newModel, toPine, type Model } from '$lib/builder/model.ts';
  import AiStrategyFields from './AiStrategyFields.svelte';
  import BuilderPane from './BuilderPane.svelte';

  const kind = $derived<ScriptKind>(app.editor.kind);
  let search = $state('');
  const allFiles = $derived(library.list(kind));
  const files = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return q ? allFiles.filter((f) => (f.name + ' ' + f.title).toLowerCase().includes(q)) : allFiles;
  });
  const label = $derived(kind === 'indicators' ? 'Indicator' : 'Strategy');

  const TEMPLATES: Record<ScriptKind, string> = {
    indicators: `//@version=5
indicator("My Indicator", shorttitle="Mine", overlay=false)

length = input.int(14, "Length", minval=1)
src = input.source(close, "Source")

value = ta.sma(src, length)
plot(value, "Value", color=color.purple)
`,
    strategies: `//@version=5
strategy("My Strategy", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100)

// Write your entry and exit rules here, for example:
// if <condition>
//     strategy.entry("Long", strategy.long)
// if <condition>
//     strategy.close("Long")
`,
  };

  let name = $state('');
  let code = $state('');
  let loadedKey = '';
  let status = $state<{ ok: boolean; text: string } | null>(null);
  let saving = $state(false);
  let ta = $state<HTMLTextAreaElement>();
  let gutter = $state<HTMLDivElement>();
  const lines = $derived(code.split('\n').length);
  const blank = $derived(!!app.editor.blank);
  const isNew = $derived(app.editor.name === null && !blank);

  // ----- settings row (always visible) and AI -----
  let aiText = $state('');
  let aiBusy = $state(false);
  let undo = $state<{ code: string } | { model: Model } | null>(null);
  let qtyType = $state<StrategyOpts['qtyType']>('percent_of_equity');
  let qty = $state('100');
  let sl = $state('');
  let tp = $state('');
  let direction = $state<StrategyOpts['direction']>('auto');
  const num = (v: string) => { const n = parseFloat(v.replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
  const qtyOk = $derived(num(qty) > 0 && (qtyType !== 'percent_of_equity' || num(qty) <= 100));

  // ----- visual builder view (strategies): replaces only the code area -----
  let mode = $state<'code' | 'builder'>('code');
  let model = $state<Model>(newModel());
  let enterSnap = '';
  const inBuilder = $derived(mode === 'builder' && kind === 'strategies');
  const snap = () => $state.snapshot(model) as Model;
  const problem = $derived(inBuilder ? checkModel(snap(), indInfo) : null);
  const builderDirty = $derived(inBuilder && JSON.stringify(snap()) !== enterSnap);

  /** Open the builder on the code: a builder-made script as it is, any other Pine code read into the builder by the AI (the closest indicators of the list). */
  async function enterBuilder() {
    const parsed = builderModelOf(code, indInfo);
    const foreign = !parsed && code.trim() !== '' && code.trim() !== TEMPLATES.strategies.trim();
    if (foreign) {
      const stored = await cachedModel(code); // converted before (also by the background job) and the code is unchanged: no AI call
      if (stored) { model = stored; enterSnap = JSON.stringify($state.snapshot(model)); mode = 'builder'; status = null; return; }
      aiBusy = true; status = { ok: true, text: 'Reading your code into the builder with the AI, this can take up to a minute…' };
      try {
        model = await convertCode(code);
        status = { ok: true, text: 'Your code was read into the builder (closest indicators of your list). Check the conditions; the code stays as it is until you change something here and save.' };
      } catch (e) {
        model = newModel();
        status = { ok: false, text: `The code could not be read into the builder (${e instanceof Error ? e.message : e}). The builder starts empty, and saving from it replaces the code. Switch back to Editor to keep the code.` };
      } finally { aiBusy = false; }
    } else model = parsed ?? newModel();
    enterSnap = JSON.stringify($state.snapshot(model));
    mode = 'builder';
    if (!foreign) status = null;
  }
  function leaveBuilder() {
    if (builderDirty) {
      if (problem) { status = { ok: false, text: `The builder changes were not applied to the code: ${problem}` }; }
      else { model.name = name.trim() || model.name; code = toPine(snap(), indInfo); }
    }
    mode = 'code';
  }
  const toggleMode = () => { if (!aiBusy) app.editorMode = inBuilder ? 'code' : 'builder'; };
  // the remembered view changes (toggle button, back / forward): open or leave the builder
  let prefSeen = app.editorMode;
  $effect(() => {
    const want = app.editorMode;
    untrack(() => {
      if (want === prefSeen) return;
      prefSeen = want;
      if (kind !== 'strategies' || app.editor.blank || aiBusy) return;
      if (want === 'builder' && mode !== 'builder') enterBuilder(); else if (want === 'code' && mode === 'builder') leaveBuilder();
    });
  });

  // the settings mirror what is open: the model in the builder, the code otherwise (also while typing)
  function readSettings() {
    if (kind !== 'strategies') return;
    if (mode === 'builder') {
      const m = model; const s = m.long.on ? m.long : m.short;
      qtyType = m.qtyType; qty = String(m.qty); sl = s.sl ? String(s.sl) : ''; tp = s.tp ? String(s.tp) : '';
      direction = m.long.on && m.short.on ? 'both' : m.short.on ? 'short' : 'long';
    } else {
      const f = extractStrategyForm(code);
      qtyType = f.qtyType; qty = String(f.qty); sl = f.sl ? String(f.sl) : ''; tp = f.tp ? String(f.tp) : ''; direction = f.direction === 'auto' ? 'both' : f.direction;
    }
  }
  $effect(() => { readSettings(); });
  // without any stop loss / take profit input the editor adds one; with only one of them present the other cannot be added
  const noSl = $derived(kind === 'strategies' && !inBuilder && !hasLimitInput(code, 'sl') && hasLimitInput(code, 'tp'));
  const noTp = $derived(kind === 'strategies' && !inBuilder && !hasLimitInput(code, 'tp') && hasLimitInput(code, 'sl'));
  const dirHint = $derived(inBuilder ? 'Switches the sides on or off; a side that has no conditions yet is created as the mirror of the other one' : 'Switches the entries of the code (allowLong / allowShort inputs); a side the code does not have yet is added by the AI as the mirror of the other one');

  /** The other side as the opposite of the one that exists: by the AI, with a local fallback. */
  async function fillSide(from: 'long' | 'short') {
    const to = from === 'long' ? 'short' : 'long';
    aiBusy = true; status = { ok: true, text: `Creating the ${to} side as the opposite of the ${from} side with the AI…` };
    const before = snap();
    try {
      const m = await aiMirrorSide(snap(), from, allInfos(), aiLight);
      model[to] = { ...m[to], on: true };
      undo = { model: before };
      status = { ok: true, text: `The ${to} side was created as the opposite of the ${from} side. Check the conditions.` };
    } catch (e) {
      model[to] = mirrorSideLocal(model[from]);
      undo = { model: before };
      status = { ok: true, text: `The AI was not available (${e instanceof Error ? e.message : e}): the ${to} side was mirrored offline (comparisons flipped, levels mirrored). Check the conditions.` };
    } finally { aiBusy = false; }
  }

  /** Add / mirror a side of a code strategy with the AI (only needed when the code has no entries for it). */
  async function extendCode(base: string, want: StrategyOpts['direction']) {
    const side = want === 'short' ? 'SHORT-only' : want === 'long' ? 'LONG-only' : 'long and short';
    const change = want === 'both'
      ? 'Add the exact opposite side so it trades long and short: keep the existing entries and exits unchanged and add the mirrored ones for the other direction (crosses reversed, comparisons reversed, oscillator levels mirrored such as 30 and 70, stop loss and take profit copied).'
      : `Turn it into the exact opposite ${side} strategy: mirror every entry and exit (crosses reversed, comparisons reversed, oscillator levels mirrored such as 30 and 70, stop loss and take profit copied).`;
    aiBusy = true; status = { ok: true, text: `Writing the ${side} version with the AI, this can take up to a minute…` };
    try {
      const out = await editStrategy(base, change, { qtyType, qty: num(qty), sl: num(sl) > 0 ? num(sl) : 0, tp: num(tp) > 0 ? num(tp) : 0, direction: want }, aiComplete);
      undo = { code }; code = out;
      status = { ok: true, text: 'The other side was added as the mirror of the existing one. Review it, then Save.' };
    } catch (e) { status = { ok: false, text: e instanceof Error ? e.message : String(e) }; readSettings(); }
    finally { aiBusy = false; }
  }

  /** Size, stop loss, take profit and direction change the code (or the builder) directly; only a side that does not exist yet needs the AI. */
  function applyParams() {
    if (aiBusy) { readSettings(); return; }
    if (!qtyOk) {
      if (inBuilder) { qtyType = model.qtyType; qty = String(model.qty); }
      else { const f = extractStrategyForm(code); qtyType = f.qtyType; qty = String(f.qty); }
      return;
    }
    const slv = num(sl) > 0 ? num(sl) : 0, tpv = num(tp) > 0 ? num(tp) : 0;
    const wantLong = direction !== 'short', wantShort = direction !== 'long';
    if (inBuilder) {
      model.qtyType = qtyType; model.qty = num(qty);
      for (const sd of [model.long, model.short]) { sd.sl = slv; sd.tp = tpv; }
      const needShort = wantShort && !model.short.entry.items.length && model.long.entry.items.length > 0;
      const needLong = wantLong && !model.long.entry.items.length && model.short.entry.items.length > 0;
      model.long.on = wantLong; model.short.on = wantShort;
      if (needShort) fillSide('long'); else if (needLong) fillSide('short');
      return;
    }
    let next = setStrategyParams(code, { qtyType, qty: num(qty), sl: noSl ? 0 : slv, tp: noTp ? 0 : tpv });
    const has = codeSides(next);
    if ((wantShort && !has.short) || (wantLong && !has.long)) {
      if (next !== code) code = next;
      extendCode(next, direction);
      return;
    }
    next = setDirection(next, direction);
    if (next !== code) { code = next; status = null; }
  }

  const canAi = $derived(!aiBusy && aiText.trim().length > 0 && (kind === 'indicators' || qtyOk));
  async function runAi() {
    if (!canAi) return;
    aiBusy = true; status = null;
    try {
      if (inBuilder) {
        const before = snap();
        const m = await aiBuilder(aiText, allInfos(), aiLight);
        undo = { model: before }; model = m; aiText = '';
        status = { ok: true, text: 'The AI filled in the builder. Check the conditions, then save.' };
      } else {
        const out = kind === 'strategies'
          ? await editStrategy(code, aiText, { qtyType, qty: num(qty), sl: num(sl) > 0 ? num(sl) : 0, tp: num(tp) > 0 ? num(tp) : 0, direction }, aiComplete)
          : await editIndicator(code, aiText, aiComplete);
        undo = { code }; code = out; aiText = '';
        status = { ok: true, text: 'AI edit applied to the editor. Review it, then Save (Ctrl+S).' };
      }
    } catch (e) { status = { ok: false, text: e instanceof Error ? e.message : String(e) }; }
    finally { aiBusy = false; }
  }
  function undoAi() {
    if (!undo) return;
    if ('model' in undo) model = undo.model; else code = undo.code;
    undo = null; status = null;
  }

  // the file name and the script title are one name: editing either changes the other
  let lastTitle = '';
  const codeTitle = $derived(scriptMeta(code).title);
  $effect(() => {
    const t = codeTitle;
    untrack(() => { if (t !== lastTitle) { lastTitle = t; if (!blank && t !== 'Untitled') name = t; } });
  });
  function onNameInput() {
    const t = name.trim();
    if (!t) return;
    if (inBuilder) model.name = t;
    else {
      const next = code.replace(/((?:indicator|strategy|study)\s*\(\s*(?:title\s*=\s*)?)(["'])(.*?)\2/, (_m, a: string, q: string) => a + q + t.replace(/["'\\]/g, '') + q);
      if (next !== code) { code = next; lastTitle = scriptMeta(next).title; }
    }
  }

  function open(k: ScriptKind, n: string | null) {
    app.editor = { kind: k, name: n };
  }

  $effect(() => {
    const key = kind + '|' + (app.editor.name ?? '') + (app.editor.blank ? '|blank' : '') + (app.editor.builder ? '|builder' : '');
    if (key === loadedKey) return;
    loadedKey = key;
    status = null; undo = null; mode = 'code';
    if (app.editor.blank) { name = ''; code = ''; }
    else if (app.editor.name === null) { name = ''; code = TEMPLATES[kind]; }
    else {
      const f = library.get(kind, app.editor.name);
      name = f?.name ?? app.editor.name;
      code = f?.code ?? '';
    }
    lastTitle = scriptMeta(code).title;
    if (kind !== 'strategies' || app.editor.blank) return;
    // the view (code / builder) stays when another strategy is picked; a library script converted before opens at once, other code goes through the AI
    if (app.editor.builder) { app.editorMode = 'builder'; prefSeen = 'builder'; }
    if (app.editorMode === 'builder') untrack(() => enterBuilder());
  });

  function check(c = code): boolean {
    const info = describeScript(c);
    if (info.error) { status = { ok: false, text: `${info.error.line ? 'Line ' + info.error.line + ': ' : ''}${info.error.message}` }; return false; }
    const expected = kind === 'indicators' ? 'indicator' : 'strategy';
    if (info.meta.kind !== expected && info.meta.kind !== 'indicator') { status = { ok: false, text: `Expected a ${expected}() declaration` }; return false; }
    status = { ok: true, text: `OK: "${info.meta.title}", ${info.inputs.length} input${info.inputs.length === 1 ? '' : 's'}, ${info.plots.length} plot${info.plots.length === 1 ? '' : 's'}` };
    return true;
  }
  function checkClick() {
    if (inBuilder) status = problem ? { ok: false, text: problem } : { ok: true, text: 'The builder strategy is valid.' };
    else check();
  }

  /** Save (and rename the file when the name field changed). Returns the saved name, or null when it failed. */
  async function save(addToChart = false) {
    if (saving || blank) return;
    let out = code;
    if (inBuilder) {
      if (problem) { status = { ok: false, text: problem }; return; }
      model.name = name.trim() || model.name;
      out = toPine(snap(), indInfo);
    }
    const info = describeScript(out);
    const finalName = (name.trim() || info.meta.title || '').trim();
    if (!finalName) { status = { ok: false, text: 'Give the script a name' }; return; }
    if (!check(out)) return;
    const old = app.editor.name;
    if (old && finalName !== old && library.get(kind, finalName)) { status = { ok: false, text: `A ${label.toLowerCase()} named "${finalName}" already exists` }; return; }
    saving = true;
    try {
      const saved = await library.save(kind, finalName, out);
      code = out;
      if (old && saved !== old) {
        // renamed: the old file goes away and every chart that used it follows the new name
        await library.remove(kind, old);
        for (const ch of app.charts) ch.indicators = ch.indicators.map((i) => (i.id === old && !!i.strategy === (kind === 'strategies') ? { ...i, id: saved } : i));
      }
      name = saved;
      loadedKey = kind + '|' + saved;
      app.editor = { kind, name: saved };
      status = { ok: true, text: old && saved !== old ? `Renamed to ${saved}.pine` : `Saved as ${saved}.pine` };
      app.notify(`${label} saved`);
      if (kind === 'strategies') convertSoon(); // the builder version of the new code is prepared in the background
      if (addToChart) {
        const on = app.chart.indicators.some((i) => i.id === saved && !!i.strategy === (kind === 'strategies'));
        if (on) app.notify(`${saved} is already on the chart`);
        else if (kind === 'strategies') { app.addStrategy(saved); paper.panelOpen = true; paper.panelTab = 'tester'; paper.persist(); }
        else app.chart.indicators = [...app.chart.indicators, { uid: crypto.randomUUID(), id: saved, params: {} }];
        app.persist();
        app.page = 'chart';
      } else app.persist();
    } catch (e) { status = { ok: false, text: String(e) }; }
    finally { saving = false; }
  }

  async function remove() {
    if (!app.editor.name) return;
    if (!confirm(`Delete ${app.editor.name}.pine?`)) return;
    await library.remove(kind, app.editor.name);
    app.editor = { kind, name: null };
  }

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Tab' && ta && document.activeElement === ta) {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      code = code.slice(0, s) + '    ' + code.slice(en);
      tick().then(() => { ta!.selectionStart = ta!.selectionEnd = s + 4; });
    }
  }
  const sync = () => { if (gutter && ta) gutter.scrollTop = ta.scrollTop; };
  const back = () => (app.page = 'chart');
</script>

<svelte:window onkeydown={(e) => { if (app.page === 'editor') { onKey(e); if (e.key === 'Escape' && document.activeElement !== ta && !(e.target as HTMLElement)?.closest('input, textarea')) back(); } }} />

<div class="page">
  <header>
    <button class="back" onclick={back}>← Charts</button>
    <h1>{label} editor</h1>
    <div class="seg">
      <button class:on={kind === 'indicators'} onclick={() => open('indicators', null)}>Indicators</button>
      <button class:on={kind === 'strategies'} onclick={() => open('strategies', null)}>Strategies</button>
    </div>
    <span class="path" title="Scripts are plain .pine files in this folder">{library.folder[kind] || 'browser storage'}</span>
  </header>

  <div class="cols">
    <aside>
      <button class="new" class:on={isNew} onclick={() => open(kind, null)}>+ New {label.toLowerCase()}</button>
      <input class="search" bind:value={search} placeholder="Search {kind}…" spellcheck="false" autocomplete="off" aria-label="Search {kind}" />
      <div class="list">
        {#each files as f (f.name)}
          <button class:on={app.editor.name === f.name} onclick={() => open(kind, f.name)} title={f.title}>{f.name}</button>
        {:else}
          <p class="dim">{search.trim() ? 'No match.' : `No ${kind} yet.`}</p>
        {/each}
      </div>
    </aside>

    <section class="main">
      <div class="bar">
        <input class="name" bind:value={name} oninput={onNameInput} placeholder={blank ? '' : isNew ? 'File name (default: script title)' : 'File name (change it and save to rename)'} spellcheck="false" disabled={blank} aria-label="File name" />
        <span class="ext">.pine</span>
        <div class="spacer"></div>
        {#if kind === 'strategies'}<button onclick={toggleMode} disabled={blank} title={inBuilder ? 'Back to the Pine code' : 'Build the strategy from indicator conditions, no code'}>{inBuilder ? 'Editor' : 'Builder'}</button>{/if}
        <button onclick={checkClick} disabled={blank}>Check</button>
        {#if !isNew && !blank}<button class="danger" onclick={remove}>Delete</button>{/if}
        <button class="primary" onclick={() => save()} disabled={saving || blank}>Save <kbd>Ctrl+S</kbd></button>
        <button class="primary" onclick={() => save(true)} disabled={saving || blank} title="Save, and put it on the chart unless it is already there">Save & add to chart</button>
      </div>
      {#if !blank}
        <div class="setrow">
          {#if kind === 'strategies'}
            <div class="settings"><AiStrategyFields bind:qtyType bind:qty bind:sl bind:tp bind:direction commit={applyParams} {noSl} {noTp} {dirHint} /></div>
          {/if}
          <div class="aibox">
            <textarea bind:value={aiText} rows="2" spellcheck="false" aria-label="Describe a change for the AI"
              placeholder={inBuilder ? 'Describe the strategy in words and let the AI fill the builder, e.g. buy when RSI crosses back above 30 while the close is above the EMA 50, sell when RSI crosses 70' : kind === 'strategies' ? 'What should change? e.g. add an RSI filter above 50 for entries, exit on a close below the EMA 20.' : 'What should change? e.g. add a signal line (EMA 9) and colour the histogram green above zero'}
              onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runAi(); } }}></textarea>
            <div class="aibtns">
              <button class="primary" onclick={runAi} disabled={!canAi} title="Ctrl+Enter">{aiBusy ? 'Working…' : inBuilder ? 'Fill with AI' : 'Edit with AI'}</button>
              {#if undo}<button onclick={undoAi}>Undo</button>{/if}
            </div>
          </div>
        </div>
      {/if}
      <div class="editor" class:bpane={inBuilder}>
        {#if blank}
          <div class="blank">Select {kind === 'indicators' ? 'an indicator' : 'a strategy'} on the left, or create a new one.</div>
        {:else if inBuilder}
          <BuilderPane bind:model />
        {:else}
          <div class="gutter" bind:this={gutter}>{#each Array(lines) as _, i}<div>{i + 1}</div>{/each}</div>
          <textarea data-nohist bind:this={ta} bind:value={code} onscroll={sync} spellcheck="false" autocomplete="off" wrap="off" placeholder={`Paste your Pine Script v5 ${label.toLowerCase()} here`}></textarea>
        {/if}
      </div>
      {#if aiBusy}<div class="status hint">Writing and test-running the change, this can take up to a minute…</div>
      {:else if status}<div class="status" class:ok={status.ok}>{status.text}</div>
      {:else if problem}<div class="status">{problem}</div>{/if}
    </section>
  </div>
</div>

<style>
  .page { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
  header { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; }
  .back { box-sizing: border-box; height: 30px; background: none; border: 1px solid var(--line); color: var(--fg); padding: 0 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .back:hover { border-color: var(--accent); color: var(--accent); }
  .seg { display: flex; border: 1px solid var(--line); }
  .seg button { height: 28px; background: none; border: 0; color: var(--dim); padding: 0 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .seg button.on { background: var(--accent); color: #fff; }
  .path { margin-left: auto; color: var(--dim); font: 11.5px ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%; }
  .cols { flex: 1; min-height: 0; display: grid; grid-template-columns: 240px 1fr; }
  aside { border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .new { margin: 10px; padding: 9px; background: none; border: 1px dashed var(--accent); color: var(--accent); font: 700 12px system-ui, sans-serif; cursor: pointer; }
  .new.on, .new:hover { background: var(--accent-soft); }
  .search { margin: 0 10px 8px; padding: 7px 10px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12.5px system-ui, sans-serif; outline: none; }
  .search:focus { border-color: var(--accent); }
  .list { overflow-y: auto; flex: 1; }
  .list button { display: block; width: 100%; text-align: left; background: none; border: 0; border-left: 2px solid transparent; color: var(--fg); padding: 7px 14px; font: 12.5px ui-monospace, monospace; cursor: pointer; }
  .list button:hover { background: var(--hover); }
  .list button.on { background: var(--accent-soft); border-left-color: var(--accent); }
  .dim { color: var(--dim); font-size: 13px; padding: 10px 14px; }
  .main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line); }
  .name { width: 280px; box-sizing: border-box; height: 30px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 0 10px; font: 13px ui-monospace, monospace; outline: none; }
  .name:focus { border-color: var(--accent); } .name:disabled { opacity: 0.7; }
  .ext { color: var(--dim); font: 13px ui-monospace, monospace; }
  .spacer { flex: 1; }
  .bar button { box-sizing: border-box; height: 30px; background: none; border: 1px solid var(--line); color: var(--fg); padding: 0 14px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .bar button:hover { border-color: var(--accent); }
  .bar .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .bar .danger:hover { border-color: var(--down); color: var(--down); }
  kbd { font: 10px ui-monospace, monospace; opacity: 0.8; margin-left: 6px; }
  .editor { flex: 1; min-height: 0; display: flex; background: #000; }
  .gutter { width: 48px; flex: none; overflow: hidden; text-align: right; padding: 12px 8px 12px 0; color: var(--dim); font: 13px/1.55 ui-monospace, monospace; border-right: 1px solid var(--line); user-select: none; }
  textarea { flex: 1; min-width: 0; resize: none; background: #000; color: var(--fg); border: 0; outline: 0; padding: 12px 14px; font: 13px/1.55 ui-monospace, monospace; tab-size: 4; white-space: pre; overflow: auto; }
  .bar button.on { border-color: var(--accent); color: var(--accent); } .bar button:disabled { opacity: 0.45; cursor: default; }
  .blank { flex: 1; display: grid; place-items: center; color: var(--dim); font-size: 14px; }
  .status { padding: 8px 16px; border-top: 1px solid var(--line); font: 12.5px ui-monospace, monospace; color: var(--down); }
  .status.ok { color: var(--up); }
  .setrow { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--bar); }
  .settings { flex: none; }
  .aibox { flex: 1; min-width: 320px; display: flex; gap: 8px; align-items: stretch; }
  .aibox textarea { flex: 1; min-width: 0; min-height: 56px; box-sizing: border-box; resize: vertical; padding: 8px 10px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12.5px/1.45 system-ui, sans-serif; outline: none; }
  .aibox textarea:focus { border-color: var(--accent); }
  .aibtns { display: flex; flex-direction: column; gap: 6px; }
  .aibtns button { box-sizing: border-box; height: 30px; background: none; border: 1px solid var(--line); color: var(--fg); padding: 0 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; white-space: nowrap; } .aibtns button:hover:not(:disabled) { border-color: var(--accent); }
  .aibtns .primary { background: var(--accent); border-color: var(--accent); color: #fff; } .aibtns button:disabled { opacity: 0.5; cursor: default; }
  .editor.bpane { display: flex; flex-direction: column; background: var(--bg); }
  .status.hint { color: var(--dim); }
</style>
