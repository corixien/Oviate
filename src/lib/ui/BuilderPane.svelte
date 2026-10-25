<script lang="ts">
  import { indInfo } from '$lib/builder/info';
  import { CMP_LABEL, BINARY, UNARY, isUnary, condText, suggest, hhmmText, parseHhmm, DAY_NAMES, PRICE_SRCS, PRICE_LABEL, SESS_STATS, SESS_LABEL, POS_LABEL, type Cmp, type Cond, type Group, type Model, type Operand, type Side } from '$lib/builder/model.ts';
  import OperandPicker from './OperandPicker.svelte';
  import Select from './Select.svelte';

  /** The conditions of a builder strategy (entry / exit per side). Size, stop loss, take profit, direction and the AI text live in the editor's settings row. */
  let { model = $bindable() }: { model: Model } = $props();
  let ideas = $state<Record<string, boolean>>({});
  let adj = $state<Record<string, boolean>>({});
  const textOf = (c: Cond) => condText($state.snapshot(c) as Cond, indInfo);

  const sides: { key: 'long' | 'short'; title: string }[] = [{ key: 'long', title: 'Long' }, { key: 'short', title: 'Short' }];
  /** unary comparisons while the right side is None, else binary; a time cannot cross or rise */
  const cmpOptions = (c: Cond) => (c.r ? BINARY : UNARY).filter((x) => c.l.k !== 'time' || !(x.startsWith('cross') || isUnary(x))).map((x) => ({ value: x, label: CMP_LABEL[x] }));

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
  function setLeft(c: Cond, o: Operand | null) {
    if (!o) return;
    c.l = o;
    if (o.k === 'time') {
      // a clock time is compared with a time: not crossing, not rising
      if (c.r?.k !== 'num') c.r = { k: 'num', v: o.f === 'tod' ? 930 : 1 };
      if (isUnary(c.cmp) || c.cmp.startsWith('cross')) c.cmp = 'at_least';
      if (c.cmp === 'between' && !c.r2) c.r2 = { k: 'num', v: o.f === 'tod' ? 1600 : 5 };
    }
  }
  function setRight(c: Cond, o: Operand | null) {
    if (o === null) { c.r = undefined; c.r2 = undefined; if (!isUnary(c.cmp)) c.cmp = 'rising'; }
    else { c.r = o; if (isUnary(c.cmp)) { c.cmp = 'cross_above'; c.n = undefined; } }
  }
  function setCmp(c: Cond, v: string) {
    c.cmp = v as Cmp;
    if (v === 'between') {
      const tod = c.l.k === 'time' && c.l.f === 'tod';
      if (!c.r) c.r = { k: 'num', v: tod ? 930 : 0 };
      if (!c.r2) c.r2 = { k: 'num', v: tod ? 1600 : 1 };
    } else c.r2 = undefined;
  }
  function setRight2(c: Cond, o: Operand | null) { if (o) c.r2 = o; }
  const intOr = (e: Event, d: number | undefined, min = 0) => { const v = Math.floor(parseFloat((e.target as HTMLInputElement).value)); return Number.isFinite(v) && v >= min ? v : d; };
  const timeOf = (o: { from: number; to: number }, k: 'from' | 'to', e: Event) => { const el = e.target as HTMLInputElement; const v = parseHhmm(el.value); if (Number.isFinite(v)) o[k] = v; else el.value = hhmmText(o[k]); };
  function apply(c: Cond, s: Cond) { const n = structuredClone(s); c.l = n.l; c.cmp = n.cmp; c.r = n.r; c.r2 = n.r2; c.n = n.n; c.within = n.within; }
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

</script>

{#snippet detail(o: Operand | undefined, other: Operand | undefined, akey: string)}
  {#if o?.k === 'num'}
    {#if other?.k === 'time' && other.f === 'tod'}
      <input class="n t" value={hhmmText(o.v)} onchange={(e) => { const v = parseHhmm((e.target as HTMLInputElement).value); if (Number.isFinite(v)) o.v = v; else (e.target as HTMLInputElement).value = hhmmText(o.v); }} aria-label="Time (hh:mm)" />
    {:else if other?.k === 'time'}
      <Select value={String(o.v)} options={DAY_NAMES.map((d, i) => ({ value: String(i + 1), label: d }))} onchange={(v) => (o.v = Number(v))} width="80px" />
    {:else}
      <input class="n" value={o.v} onchange={(e) => { const v = num(e); if (Number.isFinite(v)) o.v = v; }} aria-label="Value" />
    {/if}
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
  {:else if o?.k === 'sess'}
    <Select value={o.stat} options={SESS_STATS.map((x) => ({ value: x, label: SESS_LABEL[x] }))} onchange={(v) => (o.stat = v as typeof o.stat)} width="90px" />
    <label class="p" title="Daily window start (hh:mm, in the strategy's time zone)"><span>from</span><input class="n t" value={hhmmText(o.from)} onchange={(e) => timeOf(o, 'from', e)} /></label>
    <label class="p" title="Daily window end (hh:mm, not included)"><span>to</span><input class="n t" value={hhmmText(o.to)} onchange={(e) => timeOf(o, 'to', e)} /></label>
  {:else if o?.k === 'hl'}
    <Select value={o.fn} options={[{ value: 'highest', label: 'Highest' }, { value: 'lowest', label: 'Lowest' }]} onchange={(v) => (o.fn = v as typeof o.fn)} width="100px" />
    <Select value={o.src} options={PRICE_SRCS.map((x) => ({ value: x, label: PRICE_LABEL[x] }))} onchange={(v) => (o.src = v as typeof o.src)} width="100px" />
    <label class="p"><span>of</span><input class="n" value={o.n} onchange={(e) => (o.n = intOr(e, o.n, 1) ?? o.n)} /><span>bars</span></label>
  {:else if o?.k === 'pos'}
    <Select value={o.f} options={(['entry', 'bars', 'pnl'] as const).map((x) => ({ value: x, label: POS_LABEL[x] }))} onchange={(v) => (o.f = v as typeof o.f)} width="120px" />
  {/if}
  {#if o && (o.k === 'price' || o.k === 'ind' || o.k === 'sess' || o.k === 'hl')}
    {#if adj[akey] || o.ago || o.pct}
      <label class="p" title="Value of this many bars ago (1 = previous bar)"><span>bars ago</span><input class="n" value={o.ago ?? 0} onchange={(e) => { const v = intOr(e, 0) ?? 0; o.ago = v > 0 ? v : undefined; }} /></label>
      <label class="p" title="Scale the value by this percent (e.g. 2 = 2% higher)"><span>±%</span><input class="n" value={o.pct ?? 0} onchange={(e) => { const v = num(e); o.pct = Number.isFinite(v) && v !== 0 ? v : undefined; }} /></label>
    {:else}<button class="ic" title="Shift back N bars, or add a percent" onclick={() => (adj[akey] = true)}>±</button>{/if}
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
        <span class="dt">{@render detail(c.l, c.r, key + i + 'l')}</span>
        <Select value={c.cmp} options={cmpOptions(c)} onchange={(v) => setCmp(c, v)} width="140px" />
        <OperandPicker value={c.r ?? null} onchange={(o) => setRight(c, o)} none={c.l.k !== 'time'} fixed />
        <span class="dt">{@render detail(c.r, c.l, key + i + 'r')}</span>
        {#if c.cmp === 'between'}
          <span class="dim">and</span>
          <OperandPicker value={c.r2 ?? null} onchange={(o) => setRight2(c, o)} fixed />
          <span class="dt">{@render detail(c.r2, c.l, key + i + 'r2')}</span>
        {/if}
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

<div class="bp">
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
            <div class="slt">
              <label class="p" title="Stop opening new trades on a side after this many entries per day (0 = unlimited)"><span>Max entries per day</span><input class="n" value={side.maxPerDay ?? 0} onchange={(e) => { const v = intOr(e, 0) ?? 0; side.maxPerDay = v > 0 ? v : undefined; }} /></label>
              <span class="dim">0 = unlimited</span>
            </div>
            {#if !side.exit.items.length}<p class="note">No exit conditions: a {sd.key} trade only closes at its stop loss / take profit{sd.key === 'long' ? model.short.on ? ' or when a short entry fires' : '' : model.long.on ? ' or when a long entry fires' : ''}.</p>{/if}
          {/if}
        </section>
      {/each}
    </div>

</div>

<style>
  .bp { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px; }
  .slt { display: flex; gap: 12px; align-items: center; margin-top: 8px; }
  .n.t { width: 62px; }
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
  .n { width: 58px; padding: 0 6px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12px ui-monospace, monospace; outline: none; box-sizing: border-box; height: 30px; } .n:focus { border-color: var(--accent); }
  .ic { box-sizing: border-box; height: 30px; padding: 0 9px; background: none; border: 1px solid var(--line); color: var(--dim); font: 600 11px system-ui, sans-serif; cursor: pointer; } .ic:hover, .ic.on { border-color: var(--accent); color: var(--accent); }
  .ic.del { font-size: 15px; } .ic.del:hover { border-color: var(--down); color: var(--down); }
  .sum { margin: 3px 0 10px; color: var(--dim); font-size: 11.5px; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0 4px; }
  .chips button { padding: 4px 9px; background: none; border: 1px solid var(--line); color: var(--fg); font: 11.5px system-ui, sans-serif; cursor: pointer; } .chips button:hover { border-color: var(--accent); background: var(--accent-soft); }
  .adds { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
  .add { box-sizing: border-box; height: 30px; padding: 0 12px; background: none; border: 1px dashed var(--accent); color: var(--accent); font: 700 12px system-ui, sans-serif; cursor: pointer; } .add:hover { background: var(--accent-soft); }
  .note { margin: 6px 0; color: var(--dim); font-size: 12px; }
  .bad { color: var(--down); font-size: 12px; }
</style>
