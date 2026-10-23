<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { library } from '$lib/library.svelte';
  import { paper } from '$lib/paper/paper.svelte';
  import { aiComplete } from '$lib/api';
  import { indInfo, allInfos } from '$lib/builder/info';
  import { aiBuilder } from '$lib/builder/ai.ts';
  import { CMP_LABEL, BINARY, UNARY, isUnary, checkModel, condText, newModel, parseModel, suggest, toPine, type Cmp, type Cond, type Group, type Model, type Operand, type Side } from '$lib/builder/model.ts';
  import OperandPicker from './OperandPicker.svelte';
  import Select from './Select.svelte';

  function init(): Model {
    const name = app.builder.name;
    const code = name ? library.get('strategies', name)?.code : undefined;
    const m = code ? parseModel(code) : null;
    if (name && !m) app.notify('That strategy was not made by the builder: starting a new one');
    return m ?? newModel();
  }
  let model = $state<Model>(init());
  let fileName = $state<string | null>(app.builder.name && parseModel(library.get('strategies', app.builder.name)?.code ?? '') ? app.builder.name : null);
  let showCode = $state(false);
  let ideas = $state<Record<string, boolean>>({});
  let status = $state<{ ok: boolean; text: string } | null>(null);
  let aiText = $state('');
  let aiBusy = $state(false);

  const problem = $derived(checkModel($state.snapshot(model) as Model, indInfo));
  const code = $derived(problem ? '' : toPine($state.snapshot(model) as Model, indInfo));
  const qtyOk = $derived(model.qty > 0 && (model.qtyType !== 'percent_of_equity' || model.qty <= 100));
  const textOf = (c: Cond) => condText($state.snapshot(c) as Cond, indInfo);

  const CMP_OPTS = (un: boolean) => (un ? UNARY : BINARY).map((c) => ({ value: c, label: CMP_LABEL[c] }));

  function defaultCond(): Cond {
    const rsi = indInfo('rsi');
    return rsi?.plots.length
      ? { l: { k: 'ind', ind: 'rsi', plot: rsi.plots[0], p: {} }, cmp: 'cross_below', r: { k: 'num', v: 30 } }
      : { l: { k: 'price', src: 'close' }, cmp: 'cross_above', r: { k: 'price', src: 'open' } };
  }
  function addCond(g: Group) { g.items.push(defaultCond()); }
  function addFrom(g: Group, o: Operand | null) {
    if (!o || o.k !== 'ind') return;
    const info = indInfo(o.ind);
    const s = info ? suggest(o.ind, info)[0] : undefined;
    g.items.push(s ? structuredClone(s.cond) : { l: o, cmp: 'rising' });
  }
  function setLeft(c: Cond, o: Operand | null) { if (o) c.l = o; }
  function setRight(c: Cond, o: Operand | null) {
    if (o === null) { c.r = undefined; if (!isUnary(c.cmp)) c.cmp = 'rising'; }
    else { c.r = o; if (isUnary(c.cmp)) { c.cmp = 'cross_above'; c.n = undefined; } }
  }
  function setCmp(c: Cond, v: string) { c.cmp = v as Cmp; }
  function apply(c: Cond, s: Cond) { const n = structuredClone(s); c.l = n.l; c.cmp = n.cmp; c.r = n.r; c.n = n.n; c.within = n.within; }
  const rowIdeas = (c: Cond) => {
    const o = c.l.k === 'ind' ? c.l : c.r?.k === 'ind' ? c.r : null;
    const info = o ? indInfo(o.ind) : undefined;
    return o && info ? suggest(o.ind, info) : [];
  };
  const posNum = (e: Event, fallback: number | undefined) => { const v = Math.floor(parseFloat((e.target as HTMLInputElement).value)); return Number.isFinite(v) && v > 1 ? v : fallback; };
  const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value.replace(',', '.'));

  function setParam(o: Extract<Operand, { k: 'ind' }>, title: string, def: unknown, e: Event) {
    const v = num(e);
    if (!Number.isFinite(v) || v === Number(def)) delete o.p[title]; else o.p[title] = v;
  }
  function setPlot(o: Extract<Operand, { k: 'ind' }>, v: string) { o.plot = v; }

  async function runAi() {
    if (aiBusy || !aiText.trim()) return;
    aiBusy = true; status = null;
    try {
      const m = await aiBuilder(aiText, allInfos(), aiComplete);
      model = m; ideas = {};
      status = { ok: true, text: 'The AI filled in the builder. Check the conditions, then save.' };
      aiText = '';
    } catch (e) { status = { ok: false, text: e instanceof Error ? e.message : String(e) }; }
    finally { aiBusy = false; }
  }

  async function save(addToChart: boolean) {
    if (problem) { status = { ok: false, text: problem }; return; }
    try {
      const saved = await library.save('strategies', fileName ?? (model.name.trim() || 'Builder strategy'), code);
      fileName = saved; app.builder = { name: saved };
      status = { ok: true, text: `Saved as ${saved}.pine` };
      if (addToChart) {
        app.addStrategy(saved); paper.panelOpen = true; paper.panelTab = 'tester'; paper.persist(); app.persist();
        app.notify(`Added ${model.name}`);
        app.page = 'chart';
      } else app.notify('Strategy saved');
    } catch (e) { status = { ok: false, text: String(e) }; }
  }
  function openCode() {
    if (!fileName) { status = { ok: false, text: 'Save the strategy first.' }; return; }
    app.editor = { kind: 'strategies', name: fileName }; app.page = 'editor';
  }
  const back = () => (app.page = 'chart');
  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
    else if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest('input, textarea')) back();
  }
  const sides: { key: 'long' | 'short'; title: string }[] = [{ key: 'long', title: 'Long' }, { key: 'short', title: 'Short' }];
</script>

<svelte:window onkeydown={(e) => { if (app.page === 'builder') onKey(e); }} />

{#snippet detail(o: Operand | undefined)}
  {#if o?.k === 'num'}
    <input class="n" value={o.v} onchange={(e) => { const v = num(e); if (Number.isFinite(v)) o.v = v; }} aria-label="Value" />
  {:else if o?.k === 'ind'}
    {@const info = indInfo(o.ind)}
    {#if info}
      {#if info.plots.length > 1}
        <Select value={o.plot} options={info.plots.map((p) => ({ value: p, label: p }))} onchange={(v) => setPlot(o, v)} width="120px" />
      {/if}
      {#each info.inputs.filter((i) => i.type === 'int' || i.type === 'float') as inp (inp.title)}
        <label class="p" title={inp.title}><span>{inp.title}</span><input class="n" value={o.p[inp.title] ?? inp.def} onchange={(e) => setParam(o, inp.title, inp.def, e)} /></label>
      {/each}
    {:else}<span class="bad">missing</span>{/if}
  {/if}
{/snippet}

{#snippet groupView(g: Group, side: Side, title: string, key: string)}
  <div class="grp">
    <div class="gh">
      <b>{title}</b>
      {#if g.items.length > 1}<Select value={g.op} options={[{ value: 'and', label: 'when ALL are true' }, { value: 'or', label: 'when ANY is true' }]} onchange={(v) => (g.op = v as 'and' | 'or')} width="150px" />{:else}<span class="dim">when</span>{/if}
    </div>
    {#each g.items as c, i (i)}
      <div class="row">
        <OperandPicker value={c.l} onchange={(o) => setLeft(c, o)} />
        <span class="dt">{@render detail(c.l)}</span>
        <Select value={c.cmp} options={CMP_OPTS(!c.r)} onchange={(v) => setCmp(c, v)} width="140px" />
        <OperandPicker value={c.r ?? null} onchange={(o) => setRight(c, o)} none fixed />
        <span class="dt">{@render detail(c.r)}</span>
        {#if c.cmp === 'rising' || c.cmp === 'falling'}
          <label class="p"><span>for</span><input class="n" value={c.n ?? 1} onchange={(e) => (c.n = posNum(e, undefined))} /><span>bars</span></label>
        {/if}
        <label class="p" title="True if the condition held on any of the last N bars (1 = this bar only)"><span>within</span><input class="n" value={c.within ?? 1} onchange={(e) => (c.within = posNum(e, undefined))} /><span>bars</span></label>
        <button class="ic" title="Ideas for this indicator" class:on={ideas[key + i]} onclick={() => (ideas[key + i] = !ideas[key + i])}>Ideas</button>
        <button class="ic del" title="Remove" onclick={() => g.items.splice(i, 1)}>×</button>
      </div>
      {#if ideas[key + i]}
        <div class="chips">
          {#each rowIdeas(c) as s}<button onclick={() => apply(c, s.cond)}>{s.label}</button>{:else}<span class="dim">Pick an indicator on one side to get ready-made conditions for it.</span>{/each}
        </div>
      {/if}
      <p class="sum">{textOf(c)}</p>
    {/each}
    <div class="adds">
      <button class="add" onclick={() => addCond(g)}>+ Condition</button>
      <OperandPicker value={null} onchange={(o) => addFrom(g, o)} price={false} placeholder="+ From indicator…" width="170px" />
    </div>
  </div>
{/snippet}

<div class="page">
  <header>
    <button class="back" onclick={back}>← Charts</button>
    <h1>Strategy builder</h1>
    <input class="name" bind:value={model.name} placeholder="Strategy name" spellcheck="false" aria-label="Strategy name" />
    <div class="spacer"></div>
    <button onclick={() => (showCode = !showCode)} class:on={showCode} title="Show the Pine code that will be saved">Pine code</button>
    <button onclick={openCode} disabled={!fileName} title="Open the saved script in the code editor">Open in editor</button>
    <button onclick={() => save(false)} disabled={!!problem}>Save <kbd>Ctrl+S</kbd></button>
    <button class="primary" onclick={() => save(true)} disabled={!!problem}>Save & add to chart</button>
  </header>

  <div class="body">
    <div class="top">
      <div class="f">
        <span>Position size per entry</span>
        <div class="inline">
          <Select value={model.qtyType} options={[{ value: 'percent_of_equity', label: '% of account' }, { value: 'cash', label: 'Cash amount ($)' }, { value: 'fixed', label: 'Amount (units)' }]} onchange={(v) => (model.qtyType = v as Model['qtyType'])} width="150px" />
          <input class="n w" class:badn={!qtyOk} value={model.qty} onchange={(e) => { const v = num(e); if (Number.isFinite(v)) model.qty = v; }} aria-label="Position size" />
        </div>
      </div>
      <div class="ai">
        <textarea bind:value={aiText} rows="2" spellcheck="false" placeholder="Or describe it in words and let the AI fill the builder, e.g. buy when RSI crosses back above 30 while the close is above the EMA 50, sell when RSI crosses 70, stop loss 3%"
          onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runAi(); } }}></textarea>
        <button class="primary" onclick={runAi} disabled={aiBusy || !aiText.trim()}>{aiBusy ? 'Building…' : 'Fill with AI'}</button>
      </div>
    </div>

    <div class="sides">
      {#each sides as sd (sd.key)}
        {@const side = model[sd.key]}
        <section class="side" class:off={!side.on}>
          <div class="sh">
            <label class="tg"><input type="checkbox" bind:checked={side.on} /><span>{sd.title} trades</span></label>
            <span class="dim">{sd.key === 'long' ? 'buy first, sell later' : 'sell first, buy back later'}</span>
          </div>
          {#if side.on}
            {@render groupView(side.entry, side, 'Enter ' + sd.key, sd.key + 'e')}
            {@render groupView(side.exit, side, 'Exit ' + sd.key, sd.key + 'x')}
            {#if !side.exit.items.length}<p class="note">No exit conditions: a {sd.key} trade only closes at its stop loss / take profit{sd.key === 'long' ? model.short.on ? ' or when a short entry fires' : '' : model.long.on ? ' or when a long entry fires' : ''}.</p>{/if}
            <div class="slt">
              <label class="p"><span>Stop loss %</span><input class="n w" value={side.sl} onchange={(e) => { const v = num(e); side.sl = Number.isFinite(v) && v > 0 ? v : 0; }} /></label>
              <label class="p"><span>Take profit %</span><input class="n w" value={side.tp} onchange={(e) => { const v = num(e); side.tp = Number.isFinite(v) && v > 0 ? v : 0; }} /></label>
              <span class="dim">0 = none</span>
            </div>
          {/if}
        </section>
      {/each}
    </div>

    {#if showCode}<pre class="code">{code || '// Fix the problem above to see the code.'}</pre>{/if}
    <p class="foot">Indicators come from your indicator list. Every indicator input and every value above becomes an input of the strategy, so the Optimizer can tune them. Opening a script here regenerates its code: changes made by hand in the Pine editor are replaced when you save from the builder.</p>
  </div>

  <div class="status" class:ok={status?.ok && !problem} class:bad2={!!problem || (status && !status.ok)}>{problem ?? status?.text ?? ''}</div>
</div>

<style>
  .page { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
  header { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  h1 { margin: 0; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; }
  header button, .back { background: none; border: 1px solid var(--line); color: var(--fg); padding: 7px 14px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  header button:hover:not(:disabled) { border-color: var(--accent); } header button:disabled { opacity: 0.45; cursor: default; } header button.on { border-color: var(--accent); color: var(--accent); }
  header .primary, .primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; padding: 7px 14px; font: 700 12px system-ui, sans-serif; cursor: pointer; }
  .primary:disabled { opacity: 0.5; cursor: default; }
  kbd { font: 10px ui-monospace, monospace; opacity: 0.8; margin-left: 6px; }
  .name { width: 260px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 6px 10px; font: 13px system-ui, sans-serif; outline: none; } .name:focus { border-color: var(--accent); }
  .spacer { flex: 1; }
  .body { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
  .top { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
  .f { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--dim); }
  .inline { display: flex; gap: 6px; }
  .ai { flex: 1; min-width: 320px; display: flex; gap: 8px; align-items: stretch; }
  .ai textarea { flex: 1; resize: vertical; padding: 8px 10px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12.5px/1.45 system-ui, sans-serif; outline: none; } .ai textarea:focus { border-color: var(--accent); }
  .sides { display: grid; grid-template-columns: repeat(auto-fit, minmax(560px, 1fr)); gap: 14px; align-items: start; }
  .side { border: 1px solid var(--line); background: var(--bar); padding: 10px 12px 12px; min-width: 0; }
  .side.off { opacity: 0.7; }
  .sh { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .tg { display: flex; align-items: center; gap: 8px; font: 700 13px system-ui, sans-serif; cursor: pointer; } .tg input { accent-color: var(--accent); }
  .dim { color: var(--dim); font-size: 12px; }
  .grp { border-top: 1px solid var(--line); padding: 10px 0 4px; }
  .gh { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12.5px; } .gh b { font: 700 11px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .dt { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .p { display: inline-flex; align-items: center; gap: 5px; color: var(--dim); font-size: 11.5px; } .p span { white-space: nowrap; }
  .n { width: 58px; padding: 5px 6px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12px ui-monospace, monospace; outline: none; box-sizing: border-box; height: 28px; } .n:focus { border-color: var(--accent); }
  .n.w { width: 80px; } .badn { border-color: var(--down); }
  .ic { height: 28px; padding: 0 9px; background: none; border: 1px solid var(--line); color: var(--dim); font: 600 11px system-ui, sans-serif; cursor: pointer; } .ic:hover, .ic.on { border-color: var(--accent); color: var(--accent); }
  .ic.del { font-size: 15px; } .ic.del:hover { border-color: var(--down); color: var(--down); }
  .sum { margin: 3px 0 10px; color: var(--dim); font-size: 11.5px; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0 4px; }
  .chips button { padding: 4px 9px; background: none; border: 1px solid var(--line); color: var(--fg); font: 11.5px system-ui, sans-serif; cursor: pointer; } .chips button:hover { border-color: var(--accent); background: var(--accent-soft); }
  .adds { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
  .add { height: 30px; padding: 0 12px; background: none; border: 1px dashed var(--accent); color: var(--accent); font: 700 12px system-ui, sans-serif; cursor: pointer; } .add:hover { background: var(--accent-soft); }
  .note { margin: 6px 0; color: var(--dim); font-size: 12px; }
  .slt { display: flex; gap: 16px; align-items: center; border-top: 1px solid var(--line); padding-top: 10px; margin-top: 8px; }
  .bad { color: var(--down); font-size: 12px; }
  .code { margin: 0; padding: 12px 14px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12px/1.5 ui-monospace, monospace; overflow: auto; max-height: 360px; }
  .foot { margin: 0; color: var(--dim); font-size: 12px; max-width: 900px; }
  .status { padding: 8px 16px; border-top: 1px solid var(--line); font: 12.5px ui-monospace, monospace; min-height: 18px; color: var(--dim); }
  .status.ok { color: var(--up); } .status.bad2 { color: var(--down); }
</style>
