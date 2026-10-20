<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { library } from '$lib/library.svelte';
  import { paper } from '$lib/paper/paper.svelte';
  import { describeScript } from '$lib/pine/describe.ts';
  import Select from './Select.svelte';
  import {
    INDICATORS, PRICE_SRCS, GENERIC, defaultSpec, generate, parseSpec, companions, emptyGroup, indOperand, priceOperand, numOperand, indDef, scenariosFor, scenarioFor, scenarioCond,
    type Spec, type Group, type Cond, type Operand, type Side, type ArgDef,
  } from '$lib/builder/model.ts';

  let spec = $state<Spec>(defaultSpec());
  let saved = $state('');
  let loadedKey = '';
  let status = $state<{ ok: boolean; text: string } | null>(null);
  let saving = $state(false);
  let showCode = $state(false);

  const isNew = $derived(app.builder.name === null);
  const files = $derived(library.strategies.filter((f) => parseSpec(f.code)));
  const dirty = $derived(JSON.stringify($state.snapshot(spec)) !== saved);
  const code = $derived(showCode ? generate($state.snapshot(spec)) : '');

  $effect(() => {
    if (app.page !== 'builder') return;
    const key = app.builder.name ?? '';
    if (key === loadedKey) return;
    loadedKey = key;
    status = null;
    const f = app.builder.name ? library.get('strategies', app.builder.name) : undefined;
    spec = (f && parseSpec(f.code)) || defaultSpec();
    saved = app.builder.name ? JSON.stringify($state.snapshot(spec)) : '';
  });

  const open = (name: string | null) => { app.builder = { name }; };
  const back = () => (app.page = 'chart');

  // ---------- operands ----------
  const SRC_ALL = [
    ...PRICE_SRCS.map((s) => ({ value: 'p:' + s, label: 'Price · ' + s })),
    ...INDICATORS.map((d) => ({ value: 'i:' + d.key, label: d.group + ' · ' + d.label })),
    { value: 'n', label: 'Value' },
  ];
  const SRC_SUBJECT = SRC_ALL.filter((o) => o.value !== 'n');
  const srcOf = (o: Operand) => (o.k === 'price' ? 'p:' + o.src : o.k === 'ind' ? 'i:' + o.ind : 'n');
  const operandOf = (v: string, prev?: Operand): Operand => (v === 'n' ? numOperand(prev?.k === 'num' ? prev.v : 0) : v.startsWith('p:') ? priceOperand(v.slice(2) as never) : indOperand(v.slice(2)));

  /** What this subject can do: its own scenarios, plus the current one if it came from an older spec. */
  function scenarioOpts(c: Cond) {
    const list = scenariosFor(c.lhs).map((x) => ({ value: x.id, label: x.label }));
    if (!list.some((o) => o.value === c.cmp)) { const g = GENERIC.find((x) => x.id === c.cmp); if (g) list.push({ value: g.id, label: 'Compare output: ' + g.label }); }
    return list;
  }
  function pickSubject(c: Cond, v: string) {
    c.lhs = operandOf(v);
    if (!scenariosFor(c.lhs).some((x) => x.id === c.cmp)) pickScenario(c, scenariosFor(c.lhs)[0].id);
  }
  function pickScenario(c: Cond, id: string) {
    const n = scenarioCond(c.lhs, id);
    c.cmp = n.cmp; c.rhs = n.rhs; c.rhs2 = n.rhs2;
  }
  function pickArg(c: Cond, field: 'rhs' | 'rhs2', v: string) { c[field] = operandOf(v, c[field]); }
  function setArgNum(c: Cond, field: 'rhs' | 'rhs2', int: boolean | undefined, e: Event) {
    let v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    if (int) v = Math.max(1, Math.trunc(v));
    const o = c[field];
    if (o?.k === 'num') o.v = v; else c[field] = numOperand(v);
  }
  const showOut = (c: Cond) => c.lhs.k === 'ind' && (indDef(c.lhs.ind)?.outputs.length ?? 0) > 1 && !!scenarioFor(c.lhs, c.cmp).adv;

  const val = (e: Event) => parseFloat((e.currentTarget as HTMLInputElement).value);
  function setNum(o: Operand, e: Event) { const v = val(e); if (o.k === 'num' && Number.isFinite(v)) o.v = v; }
  function setParam(o: Operand, i: number, e: Event) { const v = val(e); if (o.k === 'ind' && Number.isFinite(v)) o.p[i] = v; }

  // ---------- groups ----------
  function newCond(): Cond { return scenarioCond(indOperand('rsi')); }
  function setQty(e: Event) { let v = val(e); if (!Number.isFinite(v) || v < 0) return; if (spec.qtyType === 'percent_of_equity') v = Math.min(100, v); spec.qty = v; }
  function setSideNum(s: Side, k: 'sl' | 'tp', e: Event) { const v = val(e); s[k] = Number.isFinite(v) && v >= 0 ? v : 0; }

  // ---------- save / apply ----------
  function check(): boolean {
    const info = describeScript(generate($state.snapshot(spec)));
    if (info.error) { status = { ok: false, text: info.error.message }; return false; }
    return true;
  }
  async function save(): Promise<string | null> {
    if (saving) return null;
    const name = (app.builder.name ?? spec.name).trim();
    if (!spec.name.trim() || !name) { status = { ok: false, text: 'Give the strategy a name' }; return null; }
    if (!check()) return null;
    saving = true;
    try {
      const snap = $state.snapshot(spec);
      const file = await library.save('strategies', name, generate(snap));
      saved = JSON.stringify(snap);
      loadedKey = file;
      app.builder = { name: file };
      status = { ok: true, text: `Saved as ${file}.pine` };
      app.notify('Strategy saved');
      return file;
    } catch (e) { status = { ok: false, text: String(e) }; return null; }
    finally { saving = false; }
  }
  async function saveAndApply() {
    const file = await save();
    if (!file) return;
    app.addStrategy(file);
    paper.panelOpen = true; paper.panelTab = 'tester'; paper.persist();
    app.persist();
    app.page = 'chart';
  }
  async function remove() {
    if (!app.builder.name || !confirm(`Delete ${app.builder.name}.pine?`)) return;
    await library.remove('strategies', app.builder.name);
    open(null);
  }

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Escape' && !app.spotlight.open && (e.target as HTMLElement)?.tagName !== 'INPUT') back();
  }
</script>

<svelte:window onkeydown={(e) => { if (app.page === 'builder') onKey(e); }} />

{#snippet indParams(o: Operand)}
  {#if o.k === 'ind'}
    {@const d = indDef(o.ind)}
    {#if d}
      {#each d.params as pd, i (pd.id)}
        <label class="pp" title={pd.label}><i>{pd.label}</i><input class="num sm" type="number" min={pd.min} step={pd.step ?? 1} value={o.p[i]} oninput={(e) => setParam(o, i, e)} /></label>
      {/each}
    {/if}
  {/if}
{/snippet}

{#snippet arg(c: Cond, field: 'rhs' | 'rhs2', d: ArgDef)}
  {@const o = c[field]}
  <div class="op">
    {#if d.num}
      <label class="pp"><i>{d.label}</i><input class="num" type="number" step={d.int ? 1 : 'any'} min={d.int ? 1 : undefined} value={o?.k === 'num' ? o.v : 0} oninput={(e) => setArgNum(c, field, d.int, e)} /></label>
    {:else if o}
      <Select value={srcOf(o)} options={SRC_ALL} onchange={(v) => pickArg(c, field, v)} width="170px" />
      {#if o.k === 'ind'}{@render indParams(o)}
      {:else if o.k === 'num'}<input class="num" type="number" step="any" value={o.v} oninput={(e) => setNum(o, e)} aria-label="value" />{/if}
    {/if}
  </div>
{/snippet}

{#snippet grp(g: Group, depth: number, onremove: (() => void) | null)}
  <div class="grp" class:nested={depth > 0}>
    <div class="ghead">
      <span class="lab">Match</span>
      <div class="seg"><button class:on={g.op === 'and'} onclick={() => (g.op = 'and')} title="All conditions must be true">ALL</button><button class:on={g.op === 'or'} onclick={() => (g.op = 'or')} title="At least one condition must be true">ANY</button></div>
      <div class="sp"></div>
      <button class="mini" onclick={() => g.items.push(newCond())}>+ Condition</button>
      {#if depth < 1}<button class="mini" title="Nested set of conditions with its own ALL/ANY, like (A and B) or (C and D)" onclick={() => g.items.push({ ...emptyGroup(g.op === 'and' ? 'or' : 'and'), items: [newCond()] })}>+ Sub-group</button>{/if}
      {#if onremove}<button class="x" onclick={onremove} aria-label="Remove sub-group" title="Remove sub-group">×</button>{/if}
    </div>
    {#each g.items as it, i (i)}
      {#if i > 0}<div class="join">{g.op === 'and' ? 'AND' : 'OR'}</div>{/if}
      {#if it.t === 'cond'}
        {@const sc = scenarioFor(it.lhs, it.cmp)}
        <div class="card">
          <button class="x" onclick={() => g.items.splice(i, 1)} aria-label="Remove condition" title="Remove condition">×</button>
          <div class="row">
            <div class="op">
              <Select value={srcOf(it.lhs)} options={SRC_SUBJECT} onchange={(v) => pickSubject(it, v)} width="170px" />
              {@render indParams(it.lhs)}
              {#if showOut(it) && it.lhs.k === 'ind'}
                {@const lo = it.lhs}
                <Select value={String(lo.out)} options={(indDef(lo.ind)?.outputs ?? []).map((n, i) => ({ value: String(i), label: n }))} onchange={(v) => { lo.out = Number(v); }} width="130px" />
              {/if}
            </div>
            <Select value={it.cmp} options={scenarioOpts(it)} onchange={(v) => pickScenario(it, v)} width="300px" />
            {#each sc.args ?? [] as d, k}
              {@render arg(it, k === 0 ? 'rhs' : 'rhs2', d)}
            {/each}
          </div>
        </div>
      {:else}
        {@render grp(it, depth + 1, () => g.items.splice(i, 1))}
      {/if}
    {:else}
      <p class="hint">No conditions: this event never fires.</p>
    {/each}
  </div>
{/snippet}

{#snippet block(title: string, g: Group)}
  <div class="blk">
    <div class="bt">{title}</div>
    {@render grp(g, 0, null)}
  </div>
{/snippet}

<div class="page">
  <header>
    <button class="back" onclick={back}>← Charts</button>
    <h1>Strategy builder</h1>
    <span class="path" title="Builder strategies are plain .pine files in this folder">{library.folder.strategies || 'browser storage'}</span>
  </header>

  <div class="cols">
    <aside>
      <button class="new" class:on={isNew} onclick={() => open(null)}>+ New builder strategy</button>
      <div class="list">
        {#each files as f (f.name)}
          <button class:on={app.builder.name === f.name} onclick={() => open(f.name)} title={f.title}>{f.name}</button>
        {:else}
          <p class="dim">No builder strategies yet.</p>
        {/each}
      </div>
      <button class="alt" onclick={() => { app.editor = { kind: 'strategies', name: null }; app.page = 'editor'; }}>Write Pine code instead</button>
    </aside>

    <section class="main">
      <div class="bar">
        <input class="name" bind:value={spec.name} placeholder="Strategy name" spellcheck="false" />
        {#if dirty}<span class="dirty" title="Unsaved changes">● unsaved</span>{/if}
        <div class="spacer"></div>
        <button onclick={() => (showCode = !showCode)}>{showCode ? 'Hide Pine' : 'Show Pine'}</button>
        {#if !isNew}<button class="danger" onclick={remove}>Delete</button>{/if}
        <button onclick={save} disabled={saving}>Save <kbd>Ctrl+S</kbd></button>
        <button class="primary" onclick={saveAndApply} disabled={saving} title="Save, put the strategy on the active chart and open the Strategy Tester">Save &amp; add to chart</button>
      </div>

      <div class="scroll">
        <div class="settings">
          <label><span>Position size per entry</span>
            <Select value={spec.qtyType} options={[{ value: 'percent_of_equity', label: '% of account' }, { value: 'cash', label: 'Cash amount ($)' }, { value: 'fixed', label: 'Amount (units)' }]} onchange={(v) => { spec.qtyType = v as Spec['qtyType']; if (v === 'percent_of_equity') spec.qty = Math.min(100, spec.qty); }} width="170px" />
            <input class="num" type="number" min="0" max={spec.qtyType === 'percent_of_equity' ? 100 : undefined} step="any" value={spec.qty} oninput={setQty} />
            <span class="dim">{spec.qtyType === 'percent_of_equity' ? '% of equity per entry' : spec.qtyType === 'cash' ? 'invested per entry' : 'units per entry'}</span></label>
        </div>
        <p class="flow">While flat (or in the opposite direction) the strategy checks the <b>entry</b> block, while in a trade it checks the <b>exit</b> block. Orders fill at the next bar open. Capital, fees and slippage are set in the Strategy Tester (Settings tab).</p>
        <p class="flow help"><b>Conditions</b> are single rules like "RSI crosses above 30". Several conditions are joined with <b>ALL</b> (every one must be true) or <b>ANY</b> (one is enough). A <b>sub-group</b> lets you mix both, like (A and B) or (C and D).</p>

        <div class="sides">
          {#each [['long', 'LONG', spec.long], ['short', 'SHORT', spec.short]] as [key, label, side] (key)}
            {@const s = side as Side}
            <div class="side {key}" class:off={!s.on}>
              <div class="shead">
                <h2>{label}</h2>
                <label class="tog"><input type="checkbox" checked={s.on} onchange={(e) => (s.on = e.currentTarget.checked)} /> <span>{s.on ? 'Enabled' : 'Disabled'}</span></label>
              </div>
              {#if s.on}
                {@render block(label + ' ENTRY', s.entry)}
                {@render block(label + ' EXIT', s.exit)}
                <div class="risk">
                  <label><span>Stop loss %</span><input class="num" type="number" min="0" step="0.1" value={s.sl} oninput={(e) => setSideNum(s, 'sl', e)} /></label>
                  <label><span>Take profit %</span><input class="num" type="number" min="0" step="0.1" value={s.tp} oninput={(e) => setSideNum(s, 'tp', e)} /></label>
                  <span class="dim">0 = off. Exits additionally to the exit event.</span>
                </div>
              {:else}
                <p class="hint">This side is off.</p>
              {/if}
            </div>
          {/each}
        </div>

        {#if showCode}<pre>{code}</pre>{/if}
        <div class="used">
          {#if companions($state.snapshot(spec)).length}<span class="dim">Own panes on the chart:</span>{/if}
          {#each companions($state.snapshot(spec)) as c}<span class="chip" title="Shown in its own pane when added to the chart">{c.id}</span>{/each}
        </div>
      </div>
      {#if status}<div class="status" class:ok={status.ok}>{status.text}</div>{/if}
    </section>
  </div>
</div>

<style>
  .page { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
  header { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; }
  .back { background: none; border: 1px solid var(--line); color: var(--fg); padding: 6px 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .back:hover { border-color: var(--accent); color: var(--accent); }
  .path { margin-left: auto; color: var(--dim); font: 11.5px ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%; }
  .cols { flex: 1; min-height: 0; display: grid; grid-template-columns: 240px 1fr; }
  aside { border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .new { margin: 10px; padding: 9px; background: none; border: 1px dashed var(--accent); color: var(--accent); font: 700 12px system-ui, sans-serif; cursor: pointer; }
  .new.on, .new:hover { background: var(--accent-soft); }
  .alt { margin: 10px; padding: 8px; background: none; border: 1px solid var(--line); color: var(--dim); font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .alt:hover { border-color: var(--accent); color: var(--fg); }
  .list { overflow-y: auto; flex: 1; }
  .list button { display: block; width: 100%; text-align: left; background: none; border: 0; border-left: 2px solid transparent; color: var(--fg); padding: 7px 14px; font: 12.5px ui-monospace, monospace; cursor: pointer; }
  .list button:hover { background: var(--hover); }
  .list button.on { background: var(--accent-soft); border-left-color: var(--accent); }
  .dim { color: var(--dim); font-size: 12.5px; } aside .dim { padding: 10px 14px; }
  .main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line); }
  .name { width: 300px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 6px 10px; font: 600 13px system-ui, sans-serif; outline: none; }
  .name:focus { border-color: var(--accent); }
  .dirty { color: var(--accent); font: 600 11.5px system-ui, sans-serif; }
  .spacer { flex: 1; } .sp { flex: 1; }
  .bar button { background: none; border: 1px solid var(--line); color: var(--fg); padding: 7px 14px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .bar button:hover { border-color: var(--accent); }
  .bar .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .bar .danger:hover { border-color: var(--down); color: var(--down); }
  kbd { font: 10px ui-monospace, monospace; opacity: 0.8; margin-left: 6px; }
  .scroll { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px 24px; }
  .settings { padding-bottom: 8px; } .settings label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dim); }
  .risk label { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dim); }
  .flow { margin: 2px 0 8px; color: var(--dim); font-size: 12px; } .flow b { color: var(--fg); } .flow.help { margin-bottom: 14px; }
  .num { width: 96px; padding: 6px 8px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12.5px ui-monospace, monospace; outline: none; box-sizing: border-box; }
  .num.sm { width: 58px; padding: 6px 6px; } .num:focus { border-color: var(--accent); }
  .sides { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
  @media (max-width: 1250px) { .sides { grid-template-columns: minmax(0, 1fr); } }
  .side { border: 1px solid var(--line); border-top: 2px solid var(--up); padding: 10px 12px 12px; background: var(--bar); }
  .side.short { border-top-color: var(--down); } .side.off { opacity: 0.7; }
  .shead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  h2 { margin: 0; font: 800 13px system-ui, sans-serif; letter-spacing: 0.14em; color: var(--up); } .short h2 { color: var(--down); }
  .tog { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dim); cursor: pointer; }
  input[type='checkbox'] { accent-color: var(--accent); width: 15px; height: 15px; }
  .blk { margin-bottom: 12px; } .bt { font: 700 10.5px system-ui, sans-serif; letter-spacing: 0.12em; color: var(--accent); margin: 0 0 6px; }
  .grp { border: 1px solid var(--line); background: #050208; padding: 8px 8px 6px; }
  .grp.nested { margin: 4px 0; border-style: dashed; border-color: var(--accent); }
  .ghead { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .lab { color: var(--dim); font-size: 11.5px; }
  .seg { display: flex; border: 1px solid var(--line); }
  .seg button { background: none; border: 0; color: var(--dim); padding: 3px 10px; font: 700 11px system-ui, sans-serif; cursor: pointer; }
  .seg button.on { background: var(--accent); color: #fff; }
  .mini { background: none; border: 1px solid var(--line); color: var(--fg); padding: 3px 9px; font: 600 11px system-ui, sans-serif; cursor: pointer; }
  .mini:hover { border-color: var(--accent); color: var(--accent); } .mini.del:hover { border-color: var(--down); color: var(--down); }
  .join { text-align: left; margin: 3px 0; color: var(--accent); font: 800 9.5px system-ui, sans-serif; letter-spacing: 0.16em; }
  .card { position: relative; border: 1px solid var(--line); background: var(--bar); padding: 8px 30px 8px 8px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .x { position: absolute; top: 2px; right: 2px; width: 22px; height: 22px; display: grid; place-items: center; background: none; border: 0; color: var(--dim); font: 16px/1 system-ui, sans-serif; cursor: pointer; }
  .x:hover { background: var(--down); color: #fff; }
  .grp.nested { position: relative; padding-right: 30px; } .grp.nested .ghead { flex-wrap: wrap; }
  .op { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .pp { display: inline-flex; align-items: center; gap: 3px; } .pp i { font-style: normal; color: var(--dim); font-size: 10.5px; }
  .and { color: var(--dim); font-size: 12px; }
  .hint { margin: 4px 2px; color: var(--dim); font-size: 12px; }
  .risk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; padding-top: 4px; }
  pre { margin: 16px 0 0; padding: 14px 16px; font: 12.5px/1.55 ui-monospace, monospace; color: var(--fg); background: #000; border: 1px solid var(--line); overflow: auto; white-space: pre; }
  .used { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
  .chip { border: 1px solid var(--line); color: var(--dim); font: 11px ui-monospace, monospace; padding: 2px 8px; }
  .status { padding: 8px 16px; border-top: 1px solid var(--line); font: 12.5px ui-monospace, monospace; color: var(--down); }
  .status.ok { color: var(--up); }
</style>
