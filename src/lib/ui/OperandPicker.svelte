<script lang="ts">
  import { library } from '$lib/library.svelte';
  import { indInfo } from '$lib/builder/info';
  import { PRICE_SRCS, PRICE_LABEL, POS_LABEL, SESS_LABEL, type Operand, type PosField } from '$lib/builder/model.ts';

  /** One side of a condition: price, a library indicator (searchable) or a fixed value; optionally "None". `value === null` is None. */
  let { value, onchange, none = false, fixed = false, price = true, extras = true, placeholder = 'Select…', width = '190px' }: {
    value: Operand | null; onchange: (o: Operand | null) => void;
    none?: boolean; fixed?: boolean; price?: boolean; /** time, session, highest / lowest and position entries */ extras?: boolean; placeholder?: string; width?: string;
  } = $props();

  let open = $state(false);
  let q = $state('');
  let root = $state<HTMLDivElement>();
  let search = $state<HTMLInputElement>();

  const label = $derived.by(() => {
    if (!value) return none ? 'None' : placeholder;
    if (value.k === 'price') return PRICE_LABEL[value.src];
    if (value.k === 'num') return 'Value';
    if (value.k === 'time') return value.f === 'tod' ? 'Time of day' : 'Day of week';
    if (value.k === 'sess') return `Session ${SESS_LABEL[value.stat].toLowerCase()}`;
    if (value.k === 'hl') return value.fn === 'highest' ? 'Highest of N bars' : 'Lowest of N bars';
    if (value.k === 'pos') return POS_LABEL[value.f];
    return library.get('indicators', value.ind)?.title ?? value.ind;
  });
  const needle = $derived(q.trim().toLowerCase());
  const inds = $derived(library.indicators.filter((f) => !needle || (f.name + ' ' + f.title).toLowerCase().includes(needle)));
  const prices = $derived(PRICE_SRCS.filter((s) => !needle || PRICE_LABEL[s].toLowerCase().includes(needle)));

  const extraItems: { label: string; make: () => Operand }[] = [
    { label: 'Time of day', make: () => ({ k: 'time', f: 'tod' }) },
    { label: 'Day of week', make: () => ({ k: 'time', f: 'dow' }) },
    { label: 'Session high / low / open / close (daily time window)', make: () => ({ k: 'sess', stat: 'high', from: 400, to: 930 }) },
    { label: 'Highest of the last N bars', make: () => ({ k: 'hl', fn: 'highest', src: 'high', n: 20, ago: 1 }) },
    { label: 'Lowest of the last N bars', make: () => ({ k: 'hl', fn: 'lowest', src: 'low', n: 20, ago: 1 }) },
    ...(['entry', 'bars', 'pnl'] as PosField[]).map((f) => ({ label: `Position: ${POS_LABEL[f].toLowerCase()}`, make: (): Operand => ({ k: 'pos', f }) })),
  ];
  const extraShown = $derived(extras ? extraItems.filter((x) => !needle || x.label.toLowerCase().includes(needle)) : []);

  function toggle() { open = !open; q = ''; if (open) setTimeout(() => search?.focus(), 20); }
  function pick(o: Operand | null) { open = false; onchange(o); }
  function pickInd(name: string) {
    const info = indInfo(name);
    if (!info?.plots.length) return;
    pick({ k: 'ind', ind: name, plot: info.plots[0], p: {} });
  }
</script>

<svelte:window onpointerdown={(e) => { if (open && root && !root.contains(e.target as Node)) open = false; }} />

<div class="op" bind:this={root} style:width>
  <button type="button" class="btn" class:open class:ph={!value && !none} onclick={toggle}>
    <span>{label}</span>
    <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
  </button>
  {#if open}
    <div class="pop">
      <input bind:this={search} bind:value={q} placeholder="Search indicators…" spellcheck="false" autocomplete="off"
        onkeydown={(e) => { if (e.key === 'Escape') open = false; else if (e.key === 'Enter' && inds.length === 1) pickInd(inds[0].name); }} />
      <div class="list" role="listbox">
        {#if none && !needle}<button type="button" class:on={value === null} onclick={() => pick(null)}>None</button>{/if}
        {#if fixed && !needle}<button type="button" class:on={value?.k === 'num'} onclick={() => pick({ k: 'num', v: 0 })}>Value (a number)</button>{/if}
        {#if price && prices.length}
          <h6>Price</h6>
          {#each prices as s (s)}<button type="button" class:on={value?.k === 'price' && value.src === s} onclick={() => pick({ k: 'price', src: s })}>{PRICE_LABEL[s]}</button>{/each}
        {/if}
        {#if extraShown.length}
          <h6>Time, ranges and position</h6>
          {#each extraShown as x (x.label)}<button type="button" onclick={() => pick(x.make())}>{x.label}</button>{/each}
        {/if}
        <h6>Indicators <i>{inds.length}</i></h6>
        {#each inds as f (f.name)}
          <button type="button" class:on={value?.k === 'ind' && value.ind === f.name} onclick={() => pickInd(f.name)}>{f.title}<small>{f.name}</small></button>
        {:else}<p>No indicator matches.</p>{/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .op { position: relative; display: inline-block; flex: none; }
  .btn { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 0 10px; height: 30px; font: 12.5px system-ui, sans-serif; cursor: pointer; text-align: left; }
  .btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btn.ph { color: var(--dim); }
  .btn:hover, .btn.open { border-color: var(--accent); }
  .btn svg { color: var(--accent); flex: none; }
  .pop { position: absolute; z-index: 60; top: 32px; left: 0; width: 280px; background: var(--glass); border: 1px solid var(--glass-line); box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.22); }
  .pop input { width: 100%; box-sizing: border-box; padding: 8px 10px; background: #000; border: 0; border-bottom: 1px solid var(--line); color: var(--fg); font: 12.5px system-ui, sans-serif; outline: none; }
  .list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; }
  .list button { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; padding: 6px 12px; background: none; border: 0; color: var(--fg); text-align: left; font: 12.5px system-ui, sans-serif; cursor: pointer; }
  .list button:hover { background: var(--hover); } .list button.on { background: var(--accent-soft); }
  .list small { color: var(--dim); font: 10.5px ui-monospace, monospace; flex: none; }
  h6 { margin: 0; padding: 8px 12px 3px; color: var(--dim); font: 700 10px system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; }
  h6 i { font-style: normal; opacity: 0.6; }
  p { margin: 0; padding: 10px 12px; color: var(--dim); font-size: 12px; }
</style>
